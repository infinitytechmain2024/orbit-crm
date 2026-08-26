do $$
begin
  create type public.project_status as enum (
    'planned',
    'active',
    'paused',
    'completed',
    'archived'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.project_priority as enum (
    'low',
    'medium',
    'high',
    'critical'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.projects
  add column if not exists description text,
  add column if not exists status public.project_status not null default 'planned',
  add column if not exists priority public.project_priority not null default 'medium',
  add column if not exists start_date date,
  add column if not exists due_date date,
  add column if not exists owner_id uuid,
  add column if not exists budget_planned numeric(14,2),
  add column if not exists currency text not null default 'EUR',
  add column if not exists archived_at timestamptz;

update public.projects as p
set owner_id = p.created_by
where p.owner_id is null
  and private.is_organization_member(p.organization_id, p.created_by);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_owner_id_fkey'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_organization_id_id_key'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_organization_id_id_key unique (organization_id, id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_date_order_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_date_order_check
      check (due_date is null or start_date is null or due_date >= start_date);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_budget_planned_nonnegative_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_budget_planned_nonnegative_check
      check (budget_planned is null or budget_planned >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_currency_format_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_currency_format_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_archived_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_archived_status_check
      check ((status = 'archived') = (archived_at is not null));
  end if;
end $$;

create table if not exists public.project_members (
  project_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  primary key (project_id, user_id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

insert into public.project_members (project_id, organization_id, user_id, created_by)
select p.id, p.organization_id, p.created_by, p.created_by
from public.projects as p
join public.organization_members as om
  on om.organization_id = p.organization_id
 and om.user_id = p.created_by
on conflict do nothing;

create index if not exists projects_owner_id_idx
  on public.projects(owner_id);

create index if not exists projects_organization_active_idx
  on public.projects(organization_id, status, priority, created_at desc)
  where archived_at is null;

create index if not exists projects_organization_archived_idx
  on public.projects(organization_id, archived_at desc)
  where archived_at is not null;

create index if not exists project_members_organization_user_idx
  on public.project_members(organization_id, user_id);

create index if not exists project_members_organization_project_idx
  on public.project_members(organization_id, project_id);

create index if not exists project_members_created_by_idx
  on public.project_members(created_by);

drop trigger if exists set_project_members_updated_at on public.project_members;
create trigger set_project_members_updated_at
  before update on public.project_members
  for each row execute function public.set_updated_at();

create or replace function private.users_share_organization(
  left_user_id uuid,
  right_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select left_user_id is not null
    and right_user_id is not null
    and exists (
      select 1
      from public.organization_members as left_member
      join public.organization_members as right_member
        on right_member.organization_id = left_member.organization_id
      where left_member.user_id = left_user_id
        and right_member.user_id = right_user_id
    );
$$;

create or replace function private.is_project_member(
  target_project_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.project_members as pm
      where pm.project_id = target_project_id
        and pm.user_id = target_user_id
    );
$$;

create or replace function private.can_manage_project(
  target_project_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.projects as p
      where p.id = target_project_id
        and (
          p.created_by = target_user_id
          or p.owner_id = target_user_id
          or private.is_project_member(p.id, target_user_id)
          or private.user_organization_role(p.organization_id, target_user_id) in (
            'owner',
            'admin',
            'manager'
          )
        )
    );
$$;

revoke execute on function private.users_share_organization(uuid, uuid)
  from public, anon;
revoke execute on function private.is_project_member(uuid, uuid)
  from public, anon;
revoke execute on function private.can_manage_project(uuid, uuid)
  from public, anon;

grant execute on function private.users_share_organization(uuid, uuid)
  to authenticated;
grant execute on function private.is_project_member(uuid, uuid)
  to authenticated;
grant execute on function private.can_manage_project(uuid, uuid)
  to authenticated;

create or replace function public.create_project(
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_color text,
  p_status public.project_status,
  p_priority public.project_priority,
  p_start_date date,
  p_due_date date,
  p_owner_id uuid,
  p_budget_planned numeric,
  p_currency text,
  p_member_ids uuid[]
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_color text := coalesce(nullif(trim(coalesce(p_color, '')), ''), 'var(--acc-1)');
  normalized_status public.project_status := coalesce(p_status, 'planned'::public.project_status);
  normalized_priority public.project_priority := coalesce(p_priority, 'medium'::public.project_priority);
  normalized_currency text := upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'EUR'));
  normalized_owner_id uuid := coalesce(p_owner_id, actor_id);
  normalized_members uuid[];
  created_project public.projects;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  if not private.is_organization_member(p_organization_id, actor_id) then
    raise exception 'Нет доступа к организации.' using errcode = '42501';
  end if;

  if normalized_name = '' then
    raise exception 'Название проекта обязательно.' using errcode = '22023';
  end if;

  if p_start_date is not null and p_due_date is not null and p_due_date < p_start_date then
    raise exception 'Дата завершения не может быть раньше даты начала.' using errcode = '22023';
  end if;

  if p_budget_planned is not null and p_budget_planned < 0 then
    raise exception 'Плановый бюджет не может быть отрицательным.' using errcode = '22023';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Валюта должна быть трёхбуквенным ISO-кодом.' using errcode = '22023';
  end if;

  if normalized_owner_id is not null
    and not private.is_organization_member(p_organization_id, normalized_owner_id) then
    raise exception 'Владелец проекта должен быть участником организации.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into normalized_members
  from (
    select unnest(
      coalesce(p_member_ids, '{}'::uuid[]) || array[normalized_owner_id, actor_id]
    ) as member_id
  ) as raw_members
  where member_id is not null;

  if exists (
    select 1
    from unnest(normalized_members) as selected_member(member_id)
    where not private.is_organization_member(p_organization_id, selected_member.member_id)
  ) then
    raise exception 'Все участники проекта должны входить в организацию.' using errcode = '22023';
  end if;

  insert into public.projects (
    organization_id,
    name,
    description,
    color,
    status,
    priority,
    start_date,
    due_date,
    owner_id,
    budget_planned,
    currency,
    created_by,
    archived_at
  )
  values (
    p_organization_id,
    normalized_name,
    nullif(trim(coalesce(p_description, '')), ''),
    normalized_color,
    normalized_status,
    normalized_priority,
    p_start_date,
    p_due_date,
    normalized_owner_id,
    p_budget_planned,
    normalized_currency,
    actor_id,
    case when normalized_status = 'archived' then now() else null end
  )
  returning * into created_project;

  insert into public.project_members (project_id, organization_id, user_id, created_by)
  select created_project.id, created_project.organization_id, member_id, actor_id
  from unnest(normalized_members) as selected_member(member_id)
  on conflict do nothing;

  return created_project;
end;
$$;

create or replace function public.update_project(
  p_project_id uuid,
  p_name text,
  p_description text,
  p_color text,
  p_status public.project_status,
  p_priority public.project_priority,
  p_start_date date,
  p_due_date date,
  p_owner_id uuid,
  p_budget_planned numeric,
  p_currency text,
  p_member_ids uuid[]
)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organization_id uuid;
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_color text := coalesce(nullif(trim(coalesce(p_color, '')), ''), 'var(--acc-1)');
  normalized_status public.project_status := coalesce(p_status, 'planned'::public.project_status);
  normalized_priority public.project_priority := coalesce(p_priority, 'medium'::public.project_priority);
  normalized_currency text := upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'EUR'));
  normalized_owner_id uuid := coalesce(p_owner_id, actor_id);
  normalized_members uuid[];
  updated_project public.projects;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  select p.organization_id
  into target_organization_id
  from public.projects as p
  where p.id = p_project_id;

  if target_organization_id is null then
    raise exception 'Проект не найден.' using errcode = 'P0002';
  end if;

  if not private.can_manage_project(p_project_id, actor_id) then
    raise exception 'Нет доступа к изменению проекта.' using errcode = '42501';
  end if;

  if normalized_name = '' then
    raise exception 'Название проекта обязательно.' using errcode = '22023';
  end if;

  if p_start_date is not null and p_due_date is not null and p_due_date < p_start_date then
    raise exception 'Дата завершения не может быть раньше даты начала.' using errcode = '22023';
  end if;

  if p_budget_planned is not null and p_budget_planned < 0 then
    raise exception 'Плановый бюджет не может быть отрицательным.' using errcode = '22023';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Валюта должна быть трёхбуквенным ISO-кодом.' using errcode = '22023';
  end if;

  if normalized_owner_id is not null
    and not private.is_organization_member(target_organization_id, normalized_owner_id) then
    raise exception 'Владелец проекта должен быть участником организации.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into normalized_members
  from (
    select unnest(
      coalesce(p_member_ids, '{}'::uuid[]) || array[normalized_owner_id, actor_id]
    ) as member_id
  ) as raw_members
  where member_id is not null;

  if exists (
    select 1
    from unnest(normalized_members) as selected_member(member_id)
    where not private.is_organization_member(target_organization_id, selected_member.member_id)
  ) then
    raise exception 'Все участники проекта должны входить в организацию.' using errcode = '22023';
  end if;

  delete from public.project_members
  where project_id = p_project_id
    and not (user_id = any(normalized_members));

  insert into public.project_members (project_id, organization_id, user_id, created_by)
  select p_project_id, target_organization_id, member_id, actor_id
  from unnest(normalized_members) as selected_member(member_id)
  on conflict do nothing;

  update public.projects
  set name = normalized_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      color = normalized_color,
      status = normalized_status,
      priority = normalized_priority,
      start_date = p_start_date,
      due_date = p_due_date,
      owner_id = normalized_owner_id,
      budget_planned = p_budget_planned,
      currency = normalized_currency,
      archived_at = case
        when normalized_status = 'archived' then coalesce(archived_at, now())
        else null
      end
  where id = p_project_id
  returning * into updated_project;

  if updated_project.id is null then
    raise exception 'Проект не найден или недоступен.' using errcode = 'P0002';
  end if;

  return updated_project;
end;
$$;

revoke execute on function public.create_project(
  uuid,
  text,
  text,
  text,
  public.project_status,
  public.project_priority,
  date,
  date,
  uuid,
  numeric,
  text,
  uuid[]
) from public, anon;

revoke execute on function public.update_project(
  uuid,
  text,
  text,
  text,
  public.project_status,
  public.project_priority,
  date,
  date,
  uuid,
  numeric,
  text,
  uuid[]
) from public, anon;

grant execute on function public.create_project(
  uuid,
  text,
  text,
  text,
  public.project_status,
  public.project_priority,
  date,
  date,
  uuid,
  numeric,
  text,
  uuid[]
) to authenticated;

grant execute on function public.update_project(
  uuid,
  text,
  text,
  text,
  public.project_status,
  public.project_priority,
  date,
  date,
  uuid,
  numeric,
  text,
  uuid[]
) to authenticated;

drop policy if exists "Organization members can read fellow member profiles"
  on public.profiles;
create policy "Organization members can read fellow member profiles"
  on public.profiles
  for select
  to authenticated
  using (private.users_share_organization(id, (select auth.uid())));

drop policy if exists "Members can create projects" on public.projects;
drop policy if exists "Members can update projects" on public.projects;
drop policy if exists "Owners admins and managers can delete projects" on public.projects;

create policy "Members can create projects"
  on public.projects
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
    and (
      owner_id is null
      or private.is_organization_member(organization_id, owner_id)
    )
  );

create policy "Project participants can update projects"
  on public.projects
  for update
  to authenticated
  using (private.can_manage_project(id, (select auth.uid())))
  with check (
    private.can_manage_project(id, (select auth.uid()))
    and private.is_organization_member(organization_id, (select auth.uid()))
    and (
      owner_id is null
      or private.is_organization_member(organization_id, owner_id)
    )
  );

alter table public.project_members enable row level security;

drop policy if exists "Organization members can read project members"
  on public.project_members;
drop policy if exists "Project managers can add project members"
  on public.project_members;
drop policy if exists "Project managers can remove project members"
  on public.project_members;

create policy "Organization members can read project members"
  on public.project_members
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Project managers can add project members"
  on public.project_members
  for insert
  to authenticated
  with check (
    private.can_manage_project(project_id, (select auth.uid()))
    and private.is_organization_member(organization_id, user_id)
  );

create policy "Project managers can remove project members"
  on public.project_members
  for delete
  to authenticated
  using (private.can_manage_project(project_id, (select auth.uid())));

revoke all privileges on table public.projects from authenticated;
revoke all privileges on table public.projects from anon;
revoke all privileges on table public.project_members from anon;
revoke all privileges on table public.project_members from authenticated;

grant select, insert, update on table public.projects to authenticated;
grant select, insert, delete on table public.project_members to authenticated;
grant usage on type public.project_status to authenticated;
grant usage on type public.project_priority to authenticated;

comment on table public.project_members is 'Participants assigned to organization-scoped projects.';
comment on column public.projects.status is 'Lifecycle status for a CRM project.';
comment on column public.projects.priority is 'Business priority for a CRM project.';
comment on column public.projects.archived_at is 'Soft archive marker. Projects are not physically deleted by the app.';
