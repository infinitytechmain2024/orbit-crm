alter table public.ai_user_memory
  add column if not exists expires_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists correction_note text,
  add column if not exists corrected_by uuid references auth.users(id) on delete set null;

create index if not exists ai_user_memory_active_idx
  on public.ai_user_memory(organization_id, user_id, updated_at desc)
  where expires_at is null;
create index if not exists ai_user_memory_expires_idx
  on public.ai_user_memory(expires_at)
  where expires_at is not null;
create index if not exists ai_user_memory_corrected_by_idx
  on public.ai_user_memory(corrected_by)
  where corrected_by is not null;

create table public.ai_user_memory_revisions (
  id bigint generated always as identity primary key,
  memory_id uuid not null references public.ai_user_memory(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_value jsonb not null,
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  source text not null,
  correction_note text,
  changed_by uuid references auth.users(id) on delete set null,
  replaced_at timestamptz not null default now()
);
create index ai_user_memory_revisions_owner_idx
  on public.ai_user_memory_revisions(organization_id, user_id, memory_id, replaced_at desc);
create index ai_user_memory_revisions_changed_by_idx
  on public.ai_user_memory_revisions(changed_by)
  where changed_by is not null;

alter table public.ai_user_memory_revisions enable row level security;
create policy ai_user_memory_revisions_owner_read on public.ai_user_memory_revisions
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_organization_member(organization_id, (select auth.uid())));
revoke all on public.ai_user_memory_revisions from anon, authenticated;
grant select on public.ai_user_memory_revisions to authenticated;
grant all on public.ai_user_memory_revisions to service_role;

create or replace function private.archive_ai_user_memory_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.memory_value is distinct from old.memory_value
     or new.confidence is distinct from old.confidence
     or new.source is distinct from old.source then
    insert into public.ai_user_memory_revisions(
      memory_id, organization_id, user_id, memory_value, confidence, source,
      correction_note, changed_by
    ) values (
      old.id, old.organization_id, old.user_id, old.memory_value, old.confidence,
      old.source, new.correction_note, new.corrected_by
    );
  end if;
  new.last_verified_at := coalesce(new.last_verified_at, now());
  return new;
end;
$$;
revoke all on function private.archive_ai_user_memory_revision() from public, anon, authenticated;
drop trigger if exists archive_ai_user_memory_revision on public.ai_user_memory;
create trigger archive_ai_user_memory_revision
before update on public.ai_user_memory
for each row execute function private.archive_ai_user_memory_revision();

create or replace function private.sync_crm_memory_graph()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_node_id uuid; linked_node_id uuid; actor_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
     where organization_id = old.organization_id
       and entity_type = tg_argv[0]
       and entity_id = old.id
       and is_automatic;
    return old;
  end if;

  actor_id := case when tg_argv[0] = 'client' then new.user_id else new.created_by end;
  insert into public.graph_nodes(
    organization_id, entity_type, entity_id, title, status, metadata, is_automatic, created_by
  ) values (
    new.organization_id, tg_argv[0], new.id,
    case when tg_argv[0] = 'client' then new.business_name else new.title end,
    new.status,
    case when tg_argv[0] = 'client'
      then jsonb_build_object('category', new.category, 'city', new.city_location)
      else jsonb_build_object('starts_at', new.starts_at, 'ends_at', new.ends_at)
    end,
    true, actor_id
  )
  on conflict (organization_id, entity_type, entity_id) do update
    set title = excluded.title, status = excluded.status,
        metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now()
  returning id into event_node_id;

  if tg_argv[0] = 'calendar_event' then
    delete from public.graph_relations
     where organization_id = new.organization_id
       and source_node_id = event_node_id
       and relation_type in ('for_client','for_task')
       and is_automatic;
    if new.client_id is not null then
      select id into linked_node_id from public.graph_nodes
       where organization_id = new.organization_id and entity_type = 'client' and entity_id = new.client_id;
      if linked_node_id is not null then
        insert into public.graph_relations(
          organization_id,source_type,source_id,target_type,target_id,relation_type,
          source_node_id,target_node_id,direction,is_automatic,created_by
        ) values (
          new.organization_id,'calendar_event',new.id,'client',new.client_id,'for_client',
          event_node_id,linked_node_id,'one_way',true,new.created_by
        ) on conflict (organization_id,source_node_id,target_node_id,relation_type,direction) do nothing;
      end if;
    end if;
    if new.task_id is not null then
      select id into linked_node_id from public.graph_nodes
       where organization_id = new.organization_id and entity_type = 'task' and entity_id = new.task_id;
      if linked_node_id is not null then
        insert into public.graph_relations(
          organization_id,source_type,source_id,target_type,target_id,relation_type,
          source_node_id,target_node_id,direction,is_automatic,created_by
        ) values (
          new.organization_id,'calendar_event',new.id,'task',new.task_id,'for_task',
          event_node_id,linked_node_id,'one_way',true,new.created_by
        ) on conflict (organization_id,source_node_id,target_node_id,relation_type,direction) do nothing;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_crm_memory_graph() from public, anon, authenticated;

drop trigger if exists sync_lead_clients_memory_graph on public.lead_clients;
create trigger sync_lead_clients_memory_graph
after insert or update or delete on public.lead_clients
for each row execute function private.sync_crm_memory_graph('client');

drop trigger if exists sync_calendar_events_memory_graph on public.calendar_events;
create trigger sync_calendar_events_memory_graph
after insert or update or delete on public.calendar_events
for each row execute function private.sync_crm_memory_graph('calendar_event');

insert into public.graph_nodes(
  organization_id,entity_type,entity_id,title,status,metadata,is_automatic,created_by
)
select organization_id,'client',id,business_name,status,
       jsonb_build_object('category',category,'city',city_location),true,user_id
  from public.lead_clients
on conflict (organization_id,entity_type,entity_id) do update
  set title=excluded.title,status=excluded.status,
      metadata=public.graph_nodes.metadata || excluded.metadata,updated_at=now();

insert into public.graph_nodes(
  organization_id,entity_type,entity_id,title,status,metadata,is_automatic,created_by
)
select organization_id,'calendar_event',id,title,status,
       jsonb_build_object('starts_at',starts_at,'ends_at',ends_at),true,created_by
  from public.calendar_events
on conflict (organization_id,entity_type,entity_id) do update
  set title=excluded.title,status=excluded.status,
      metadata=public.graph_nodes.metadata || excluded.metadata,updated_at=now();
;
