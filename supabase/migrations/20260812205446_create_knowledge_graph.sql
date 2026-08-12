do $$
begin
  create type public.graph_object_type as enum (
    'project',
    'task',
    'person',
    'client',
    'site',
    'page',
    'document',
    'note',
    'prompt',
    'generation',
    'image',
    'file',
    'comment',
    'email',
    'decision',
    'approval',
    'finance_transaction',
    'request',
    'task_label',
    'checklist_item'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.graph_relation_type as enum (
    'belongs_to',
    'contains',
    'assigned_to',
    'created_from',
    'uses',
    'used_in',
    'related_to',
    'requires_approval',
    'blocks',
    'depends_on',
    'generated_from_prompt'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.graph_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type public.graph_object_type not null,
  source_id uuid not null,
  target_type public.graph_object_type not null,
  target_id uuid not null,
  relation_type public.graph_relation_type not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  constraint graph_relations_distinct_endpoints_check
    check ((source_type, source_id) <> (target_type, target_id)),
  constraint graph_relations_unique_edge
    unique (
      organization_id,
      source_type,
      source_id,
      target_type,
      target_id,
      relation_type
    )
);

create table if not exists public.graph_node_positions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  node_type public.graph_object_type not null,
  node_id uuid not null,
  x_position double precision not null,
  y_position double precision not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, node_type, node_id)
);

create index if not exists graph_relations_source_lookup_idx
  on public.graph_relations (organization_id, source_type, source_id, created_at desc);

create index if not exists graph_relations_target_lookup_idx
  on public.graph_relations (organization_id, target_type, target_id, created_at desc);

create index if not exists graph_relations_created_by_idx
  on public.graph_relations (created_by);

create index if not exists graph_node_positions_user_lookup_idx
  on public.graph_node_positions (user_id, organization_id);

create trigger set_graph_node_positions_updated_at
  before update on public.graph_node_positions
  for each row execute function public.set_updated_at();

create or replace function private.graph_object_is_visible(
  target_organization_id uuid,
  target_type public.graph_object_type,
  target_id uuid,
  target_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_user_id is null
    or not private.is_organization_member(target_organization_id, target_user_id) then
    return false;
  end if;

  return case target_type
    when 'project' then exists (
      select 1 from public.projects p
      where p.organization_id = target_organization_id and p.id = target_id
    )
    when 'task' then exists (
      select 1 from public.tasks t
      where t.organization_id = target_organization_id and t.id = target_id
    )
    when 'person' then exists (
      select 1 from public.organization_members om
      where om.organization_id = target_organization_id and om.user_id = target_id
    )
    when 'client' then exists (
      select 1 from public.leads l
      where l.organization_id = target_organization_id and l.id = target_id
    )
    when 'document' then exists (
      select 1 from public.files f
      where f.organization_id = target_organization_id and f.id = target_id
    )
    when 'image' then exists (
      select 1 from public.files f
      where f.organization_id = target_organization_id and f.id = target_id
    )
    when 'file' then exists (
      select 1 from public.files f
      where f.organization_id = target_organization_id and f.id = target_id
    )
    when 'comment' then exists (
      select 1 from public.task_comments c
      where c.organization_id = target_organization_id and c.id = target_id
    )
    when 'finance_transaction' then exists (
      select 1 from public.finance_transactions ft
      where ft.organization_id = target_organization_id and ft.id = target_id
    )
    when 'task_label' then exists (
      select 1 from public.task_labels tl
      where tl.organization_id = target_organization_id and tl.id = target_id
    )
    when 'checklist_item' then exists (
      select 1 from public.task_checklist_items ci
      where ci.organization_id = target_organization_id and ci.id = target_id
    )
    else false
  end;
end;
$$;

revoke execute on function private.graph_object_is_visible(
  uuid,
  public.graph_object_type,
  uuid,
  uuid
) from public, anon;

grant execute on function private.graph_object_is_visible(
  uuid,
  public.graph_object_type,
  uuid,
  uuid
) to authenticated;

alter table public.graph_relations enable row level security;
alter table public.graph_node_positions enable row level security;

create policy "Members can read visible graph relations"
  on public.graph_relations
  for select
  to authenticated
  using (
    private.graph_object_is_visible(
      organization_id,
      source_type,
      source_id,
      (select auth.uid())
    )
    and private.graph_object_is_visible(
      organization_id,
      target_type,
      target_id,
      (select auth.uid())
    )
  );

create policy "Members can create visible graph relations"
  on public.graph_relations
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.graph_object_is_visible(
      organization_id,
      source_type,
      source_id,
      (select auth.uid())
    )
    and private.graph_object_is_visible(
      organization_id,
      target_type,
      target_id,
      (select auth.uid())
    )
  );

create policy "Creators and managers can delete graph relations"
  on public.graph_relations
  for delete
  to authenticated
  using (
    private.is_organization_member(organization_id, (select auth.uid()))
    and (
      created_by = (select auth.uid())
      or private.user_organization_role(organization_id, (select auth.uid())) in (
        'owner',
        'admin',
        'manager'
      )
    )
  );

create policy "Users can read their graph positions"
  on public.graph_node_positions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Users can create their graph positions"
  on public.graph_node_positions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Users can update their graph positions"
  on public.graph_node_positions
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Users can delete their graph positions"
  on public.graph_node_positions
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

revoke all privileges on table public.graph_relations from anon, authenticated;
revoke all privileges on table public.graph_node_positions from anon, authenticated;

grant select, insert, delete on table public.graph_relations to authenticated;
grant select, insert, update, delete on table public.graph_node_positions to authenticated;
grant usage on type public.graph_object_type to authenticated;
grant usage on type public.graph_relation_type to authenticated;

comment on table public.graph_relations is
  'Explicit organization-scoped relationships between knowledge graph objects. Foreign-key-derived relationships are assembled at read time.';
comment on table public.graph_node_positions is
  'Per-user positions for manually arranged knowledge graph nodes.';
