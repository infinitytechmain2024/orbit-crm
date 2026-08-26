create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

do $$
begin
  create type public.organization_role as enum ('owner', 'admin', 'manager', 'member', 'accountant');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.task_status as enum ('inbox', 'todo', 'doing', 'done');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.task_priority as enum ('low', 'med', 'high');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.finance_transaction_type as enum ('income', 'expense');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (organization_id, user_id)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  color text not null default 'var(--acc-1)',
  x_position numeric(5,2) not null default 50 check (x_position >= 0 and x_position <= 100),
  y_position numeric(5,2) not null default 50 check (y_position >= 0 and y_position <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);

create table if not exists public.project_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_project_id uuid not null references public.projects(id) on delete cascade,
  target_project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  primary key (source_project_id, target_project_id),
  check (source_project_id <> target_project_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0),
  note text,
  status public.task_status not null default 'inbox',
  priority public.task_priority not null default 'med',
  due_date date,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (char_length(trim(label)) > 0),
  amount numeric(12,2) not null check (amount >= 0),
  type public.finance_transaction_type not null,
  category text not null check (char_length(trim(category)) > 0),
  occurred_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);

create index if not exists organization_members_user_id_idx
  on public.organization_members(user_id);

create index if not exists organization_members_role_idx
  on public.organization_members(organization_id, role);

create index if not exists projects_organization_id_idx
  on public.projects(organization_id);

create index if not exists project_links_organization_id_idx
  on public.project_links(organization_id);

create index if not exists tasks_organization_status_idx
  on public.tasks(organization_id, status);

create index if not exists tasks_project_id_idx
  on public.tasks(project_id);

create index if not exists finance_transactions_organization_date_idx
  on public.finance_transactions(organization_id, occurred_on desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function private.user_organization_role(
  target_organization_id uuid,
  target_user_id uuid
)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select om.role
  from public.organization_members as om
  where om.organization_id = target_organization_id
    and om.user_id = target_user_id
  limit 1;
$$;

create or replace function private.is_organization_member(
  target_organization_id uuid,
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
      from public.organization_members as om
      where om.organization_id = target_organization_id
        and om.user_id = target_user_id
    );
$$;

create or replace function private.organization_has_members(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as om
    where om.organization_id = target_organization_id
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.user_organization_role(uuid, uuid) to authenticated;
grant execute on function private.is_organization_member(uuid, uuid) to authenticated;
grant execute on function private.organization_has_members(uuid) to authenticated;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger set_organization_members_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

create trigger set_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger set_project_links_updated_at
  before update on public.project_links
  for each row execute function public.set_updated_at();

create trigger set_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger set_finance_transactions_updated_at
  before update on public.finance_transactions
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_links enable row level security;
alter table public.tasks enable row level security;
alter table public.finance_transactions enable row level security;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Members can read their organizations"
  on public.organizations
  for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_organization_member(id, (select auth.uid()))
  );

create policy "Authenticated users can create organizations"
  on public.organizations
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "Owners and admins can update organizations"
  on public.organizations
  for update
  to authenticated
  using (private.user_organization_role(id, (select auth.uid())) in ('owner', 'admin'))
  with check (private.user_organization_role(id, (select auth.uid())) in ('owner', 'admin'));

create policy "Owners can delete organizations"
  on public.organizations
  for delete
  to authenticated
  using (private.user_organization_role(id, (select auth.uid())) = 'owner');

create policy "Members can read organization members"
  on public.organization_members
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Creators can add first owner membership"
  on public.organization_members
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and created_by = (select auth.uid())
    and role = 'owner'
    and not private.organization_has_members(organization_id)
    and exists (
      select 1
      from public.organizations as org
      where org.id = organization_id
        and org.created_by = (select auth.uid())
    )
  );

create policy "Owners and admins can add members"
  on public.organization_members
  for insert
  to authenticated
  with check (
    private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin')
  );

create policy "Owners and admins can update members"
  on public.organization_members
  for update
  to authenticated
  using (private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin'))
  with check (private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin'));

create policy "Owners and admins can remove members"
  on public.organization_members
  for delete
  to authenticated
  using (private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin'));

create policy "Members can read projects"
  on public.projects
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create projects"
  on public.projects
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update projects"
  on public.projects
  for update
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())))
  with check (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Owners admins and managers can delete projects"
  on public.projects
  for delete
  to authenticated
  using (
    private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin', 'manager')
  );

create policy "Members can read project links"
  on public.project_links
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create project links"
  on public.project_links
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update project links"
  on public.project_links
  for update
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())))
  with check (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can delete project links"
  on public.project_links
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read tasks"
  on public.tasks
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create tasks"
  on public.tasks
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update tasks"
  on public.tasks
  for update
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())))
  with check (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can delete tasks"
  on public.tasks
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read finance transactions"
  on public.finance_transactions
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Accountants and managers can create finance transactions"
  on public.finance_transactions
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.user_organization_role(organization_id, (select auth.uid())) in (
      'owner',
      'admin',
      'manager',
      'accountant'
    )
  );

create policy "Accountants and managers can update finance transactions"
  on public.finance_transactions
  for update
  to authenticated
  using (
    private.user_organization_role(organization_id, (select auth.uid())) in (
      'owner',
      'admin',
      'manager',
      'accountant'
    )
  )
  with check (
    private.user_organization_role(organization_id, (select auth.uid())) in (
      'owner',
      'admin',
      'manager',
      'accountant'
    )
  );

create policy "Owners and admins can delete finance transactions"
  on public.finance_transactions
  for delete
  to authenticated
  using (
    private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin')
  );

grant usage on schema public to anon, authenticated;
grant usage on type public.organization_role to authenticated;
grant usage on type public.task_status to authenticated;
grant usage on type public.task_priority to authenticated;
grant usage on type public.finance_transaction_type to authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_links to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.finance_transactions to authenticated;

comment on table public.organizations is 'Tenant boundary for Orbit CRM data.';
comment on table public.organization_members is 'Membership and role map for organization-scoped RLS.';
comment on column public.projects.organization_id is 'Required tenant boundary column for business entities.';
comment on column public.projects.created_by is 'Auth user who created this business entity.';
comment on column public.tasks.organization_id is 'Required tenant boundary column for business entities.';
comment on column public.tasks.created_by is 'Auth user who created this business entity.';
comment on column public.finance_transactions.organization_id is 'Required tenant boundary column for business entities.';
comment on column public.finance_transactions.created_by is 'Auth user who created this business entity.';;
