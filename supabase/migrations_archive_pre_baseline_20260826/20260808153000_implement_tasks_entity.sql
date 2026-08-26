alter table public.tasks
  alter column status drop default;

alter table public.tasks
  alter column status type text
  using case status::text
    when 'inbox' then 'backlog'
    when 'todo' then 'planned'
    when 'doing' then 'in_progress'
    when 'done' then 'completed'
    else status::text
  end;

alter table public.tasks
  alter column status set default 'backlog';

drop type if exists public.task_status;

create type public.task_status as enum (
  'backlog',
  'planned',
  'in_progress',
  'review',
  'blocked',
  'completed',
  'cancelled'
);

alter table public.tasks
  add column if not exists parent_task_id uuid,
  add column if not exists description text,
  add column if not exists start_date date,
  add column if not exists estimated_minutes integer,
  add column if not exists actual_minutes integer not null default 0,
  add column if not exists assignee_id uuid,
  add column if not exists author_id uuid,
  add column if not exists expected_revenue numeric(14,2),
  add column if not exists internal_cost numeric(14,2),
  add column if not exists currency text not null default 'EUR',
  add column if not exists sort_order numeric(14,4) not null default 0,
  add column if not exists completed_at timestamptz,
  add column if not exists archived_at timestamptz;

update public.tasks
set description = coalesce(description, note),
    author_id = coalesce(author_id, created_by),
    completed_at = case
      when status = 'completed' then coalesce(completed_at, updated_at, created_at)
      else null
    end
where description is null
   or author_id is null
   or (status = 'completed' and completed_at is null)
   or (status <> 'completed' and completed_at is not null);

alter table public.tasks
  alter column author_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_organization_id_id_key'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_organization_id_id_key unique (organization_id, id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_status_allowed_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_status_allowed_check
      check (
        status in (
          'backlog',
          'planned',
          'in_progress',
          'review',
          'blocked',
          'completed',
          'cancelled'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_project_same_organization_fkey'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_project_same_organization_fkey
      foreign key (organization_id, project_id)
      references public.projects(organization_id, id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_parent_task_same_organization_fkey'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_parent_task_same_organization_fkey
      foreign key (organization_id, parent_task_id)
      references public.tasks(organization_id, id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_assignee_same_organization_fkey'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_assignee_same_organization_fkey
      foreign key (organization_id, assignee_id)
      references public.organization_members(organization_id, user_id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_author_same_organization_fkey'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_author_same_organization_fkey
      foreign key (organization_id, author_id)
      references public.organization_members(organization_id, user_id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_date_order_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_date_order_check
      check (due_date is null or start_date is null or due_date >= start_date);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_nonnegative_numbers_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_nonnegative_numbers_check
      check (
        (estimated_minutes is null or estimated_minutes >= 0)
        and actual_minutes >= 0
        and (expected_revenue is null or expected_revenue >= 0)
        and (internal_cost is null or internal_cost >= 0)
        and sort_order >= 0
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_currency_format_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_currency_format_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_parent_not_self_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_parent_not_self_check
      check (parent_task_id is null or parent_task_id <> id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_completed_timestamp_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_completed_timestamp_check
      check ((status = 'completed') = (completed_at is not null));
  end if;
end $$;

create table if not exists public.task_assignees (
  task_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  primary key (task_id, user_id),
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create table if not exists public.task_watchers (
  task_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  primary key (task_id, user_id),
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create table if not exists public.task_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  color text not null default 'var(--acc-1)',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'task_labels_organization_id_id_key'
      and conrelid = 'public.task_labels'::regclass
  ) then
    alter table public.task_labels
      add constraint task_labels_organization_id_id_key unique (organization_id, id);
  end if;
end $$;

create table if not exists public.task_label_links (
  task_id uuid not null,
  label_id uuid not null,
  organization_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  primary key (task_id, label_id),
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, label_id)
    references public.task_labels(organization_id, id) on delete cascade
);

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  organization_id uuid not null,
  title text not null check (char_length(trim(title)) > 0),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  sort_order numeric(14,4) not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  organization_id uuid not null,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  organization_id uuid not null,
  bucket_id text not null default 'task-files',
  storage_path text not null unique,
  file_name text not null check (char_length(trim(file_name)) > 0),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 6291456),
  created_at timestamptz not null default now(),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade
);

alter table public.finance_transactions
  add column if not exists task_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_transactions_task_same_organization_fkey'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_task_same_organization_fkey
      foreign key (organization_id, task_id)
      references public.tasks(organization_id, id)
      on delete restrict;
  end if;
end $$;

insert into public.task_assignees (task_id, organization_id, user_id, created_by)
select t.id, t.organization_id, t.assignee_id, t.created_by
from public.tasks as t
where t.assignee_id is not null
on conflict do nothing;

create unique index if not exists task_labels_organization_lower_name_key
  on public.task_labels(organization_id, lower(name));

create index if not exists tasks_organization_active_idx
  on public.tasks(organization_id, status, priority, sort_order, created_at desc)
  where archived_at is null;

create index if not exists tasks_organization_archived_idx
  on public.tasks(organization_id, archived_at desc)
  where archived_at is not null;

create index if not exists tasks_parent_task_id_idx
  on public.tasks(parent_task_id);

create index if not exists tasks_assignee_id_idx
  on public.tasks(assignee_id);

create index if not exists tasks_author_id_idx
  on public.tasks(author_id);

create index if not exists task_assignees_organization_user_idx
  on public.task_assignees(organization_id, user_id);

create index if not exists task_assignees_created_by_idx
  on public.task_assignees(created_by);

create index if not exists task_watchers_organization_user_idx
  on public.task_watchers(organization_id, user_id);

create index if not exists task_watchers_created_by_idx
  on public.task_watchers(created_by);

create index if not exists task_label_links_organization_label_idx
  on public.task_label_links(organization_id, label_id);

create index if not exists task_label_links_created_by_idx
  on public.task_label_links(created_by);

create index if not exists task_checklist_items_task_sort_idx
  on public.task_checklist_items(organization_id, task_id, sort_order, created_at);

create index if not exists task_checklist_items_created_by_idx
  on public.task_checklist_items(created_by);

create index if not exists task_comments_task_created_idx
  on public.task_comments(organization_id, task_id, created_at);

create index if not exists task_comments_created_by_idx
  on public.task_comments(created_by);

create index if not exists files_task_created_idx
  on public.files(organization_id, task_id, created_at desc);

create index if not exists files_uploaded_by_idx
  on public.files(uploaded_by);

create index if not exists finance_transactions_task_id_idx
  on public.finance_transactions(task_id)
  where task_id is not null;

create or replace function public.set_task_status_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at = coalesce(new.completed_at, now());
    else
      new.completed_at = coalesce(new.completed_at, old.completed_at, now());
    end if;
  else
    new.completed_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_tasks_status_timestamps on public.tasks;
create trigger set_tasks_status_timestamps
  before insert or update on public.tasks
  for each row execute function public.set_task_status_timestamps();

drop trigger if exists set_task_labels_updated_at on public.task_labels;
create trigger set_task_labels_updated_at
  before update on public.task_labels
  for each row execute function public.set_updated_at();

drop trigger if exists set_task_checklist_items_updated_at on public.task_checklist_items;
create trigger set_task_checklist_items_updated_at
  before update on public.task_checklist_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_task_comments_updated_at on public.task_comments;
create trigger set_task_comments_updated_at
  before update on public.task_comments
  for each row execute function public.set_updated_at();

create or replace function private.can_manage_task(
  target_task_id uuid,
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
      from public.tasks as t
      where t.id = target_task_id
        and private.is_organization_member(t.organization_id, target_user_id)
    );
$$;

create or replace function private.storage_object_organization_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_folder text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if first_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return first_folder::uuid;
  end if;

  return null;
end;
$$;

revoke execute on function private.can_manage_task(uuid, uuid)
  from public, anon;
revoke execute on function private.storage_object_organization_id(text)
  from public, anon;

grant execute on function private.can_manage_task(uuid, uuid)
  to authenticated;
grant execute on function private.storage_object_organization_id(text)
  to authenticated;

create or replace function public.archive_task(p_task_id uuid)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  archived_task public.tasks;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  if not private.can_manage_task(p_task_id, actor_id) then
    raise exception 'Нет доступа к задаче.' using errcode = '42501';
  end if;

  update public.tasks
  set archived_at = coalesce(archived_at, now())
  where id = p_task_id
  returning * into archived_task;

  if archived_task.id is null then
    raise exception 'Задача не найдена.' using errcode = 'P0002';
  end if;

  return archived_task;
end;
$$;

create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organization_id uuid;
  child_count bigint;
  finance_count bigint;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  select t.organization_id
  into target_organization_id
  from public.tasks as t
  where t.id = p_task_id;

  if target_organization_id is null then
    raise exception 'Задача не найдена.' using errcode = 'P0002';
  end if;

  if not private.can_manage_task(p_task_id, actor_id) then
    raise exception 'Нет доступа к задаче.' using errcode = '42501';
  end if;

  select count(*)
  into child_count
  from public.tasks as child_task
  where child_task.organization_id = target_organization_id
    and child_task.parent_task_id = p_task_id;

  select count(*)
  into finance_count
  from public.finance_transactions as tx
  where tx.organization_id = target_organization_id
    and tx.task_id = p_task_id;

  if child_count > 0 or finance_count > 0 then
    raise exception 'TASK_ARCHIVE_REQUIRED: У задачи есть дочерние задачи или финансовые операции. Архивируйте её вместо удаления.'
      using errcode = 'P0001';
  end if;

  delete from public.tasks
  where id = p_task_id;
end;
$$;

revoke execute on function public.archive_task(uuid) from public, anon;
revoke execute on function public.delete_task(uuid) from public, anon;
grant execute on function public.archive_task(uuid) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;

alter table public.task_assignees enable row level security;
alter table public.task_watchers enable row level security;
alter table public.task_labels enable row level security;
alter table public.task_label_links enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_comments enable row level security;
alter table public.files enable row level security;

drop policy if exists "Members can read task assignees" on public.task_assignees;
drop policy if exists "Members can create task assignees" on public.task_assignees;
drop policy if exists "Members can delete task assignees" on public.task_assignees;

create policy "Members can read task assignees"
  on public.task_assignees
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create task assignees"
  on public.task_assignees
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
    and private.is_organization_member(organization_id, user_id)
  );

create policy "Members can delete task assignees"
  on public.task_assignees
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

drop policy if exists "Members can read task watchers" on public.task_watchers;
drop policy if exists "Members can create task watchers" on public.task_watchers;
drop policy if exists "Members can delete task watchers" on public.task_watchers;

create policy "Members can read task watchers"
  on public.task_watchers
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create task watchers"
  on public.task_watchers
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
    and private.is_organization_member(organization_id, user_id)
  );

create policy "Members can delete task watchers"
  on public.task_watchers
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

drop policy if exists "Members can read task labels" on public.task_labels;
drop policy if exists "Members can create task labels" on public.task_labels;
drop policy if exists "Members can update task labels" on public.task_labels;
drop policy if exists "Members can delete task labels" on public.task_labels;

create policy "Members can read task labels"
  on public.task_labels
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create task labels"
  on public.task_labels
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update task labels"
  on public.task_labels
  for update
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())))
  with check (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can delete task labels"
  on public.task_labels
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

drop policy if exists "Members can read task label links" on public.task_label_links;
drop policy if exists "Members can create task label links" on public.task_label_links;
drop policy if exists "Members can delete task label links" on public.task_label_links;

create policy "Members can read task label links"
  on public.task_label_links
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create task label links"
  on public.task_label_links
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can delete task label links"
  on public.task_label_links
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

drop policy if exists "Members can read task checklist items" on public.task_checklist_items;
drop policy if exists "Members can create task checklist items" on public.task_checklist_items;
drop policy if exists "Members can update task checklist items" on public.task_checklist_items;
drop policy if exists "Members can delete task checklist items" on public.task_checklist_items;

create policy "Members can read task checklist items"
  on public.task_checklist_items
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create task checklist items"
  on public.task_checklist_items
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update task checklist items"
  on public.task_checklist_items
  for update
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())))
  with check (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can delete task checklist items"
  on public.task_checklist_items
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

drop policy if exists "Members can read task comments" on public.task_comments;
drop policy if exists "Members can create task comments" on public.task_comments;
drop policy if exists "Members can update task comments" on public.task_comments;
drop policy if exists "Members can delete task comments" on public.task_comments;

create policy "Members can read task comments"
  on public.task_comments
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create task comments"
  on public.task_comments
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update task comments"
  on public.task_comments
  for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  )
  with check (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can delete task comments"
  on public.task_comments
  for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

drop policy if exists "Members can read files" on public.files;
drop policy if exists "Members can create files" on public.files;
drop policy if exists "Members can delete files" on public.files;

create policy "Members can read files"
  on public.files
  for select
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create files"
  on public.files
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can delete files"
  on public.files
  for delete
  to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-files',
  'task-files',
  false,
  6291456,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Organization members can read task storage objects" on storage.objects;
drop policy if exists "Organization members can upload task storage objects" on storage.objects;
drop policy if exists "Organization members can update task storage objects" on storage.objects;
drop policy if exists "Organization members can delete task storage objects" on storage.objects;

create policy "Organization members can read task storage objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-files'
    and private.is_organization_member(
      private.storage_object_organization_id(name),
      (select auth.uid())
    )
  );

create policy "Organization members can upload task storage objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-files'
    and private.is_organization_member(
      private.storage_object_organization_id(name),
      (select auth.uid())
    )
  );

create policy "Organization members can update task storage objects"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'task-files'
    and private.is_organization_member(
      private.storage_object_organization_id(name),
      (select auth.uid())
    )
  )
  with check (
    bucket_id = 'task-files'
    and private.is_organization_member(
      private.storage_object_organization_id(name),
      (select auth.uid())
    )
  );

create policy "Organization members can delete task storage objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-files'
    and private.is_organization_member(
      private.storage_object_organization_id(name),
      (select auth.uid())
    )
  );

revoke all privileges on table public.task_assignees from anon, authenticated;
revoke all privileges on table public.task_watchers from anon, authenticated;
revoke all privileges on table public.task_labels from anon, authenticated;
revoke all privileges on table public.task_label_links from anon, authenticated;
revoke all privileges on table public.task_checklist_items from anon, authenticated;
revoke all privileges on table public.task_comments from anon, authenticated;
revoke all privileges on table public.files from anon, authenticated;

grant select, insert, delete on table public.task_assignees to authenticated;
grant select, insert, delete on table public.task_watchers to authenticated;
grant select, insert, update, delete on table public.task_labels to authenticated;
grant select, insert, delete on table public.task_label_links to authenticated;
grant select, insert, update, delete on table public.task_checklist_items to authenticated;
grant select, insert, update, delete on table public.task_comments to authenticated;
grant select, insert, delete on table public.files to authenticated;
grant usage on type public.task_status to authenticated;

comment on table public.task_assignees is 'Additional assignee map for organization-scoped tasks.';
comment on table public.task_watchers is 'Users subscribed to task updates.';
comment on table public.task_labels is 'Organization-scoped task labels.';
comment on table public.task_label_links is 'Many-to-many links between tasks and labels.';
comment on table public.task_checklist_items is 'Checklist items that belong to tasks.';
comment on table public.task_comments is 'Persistent task comments.';
comment on table public.files is 'Metadata for Supabase Storage objects attached to tasks.';
comment on column public.tasks.status is 'Task lifecycle status stored as an untranslated key.';
comment on column public.tasks.parent_task_id is 'Optional self-reference for subtasks.';
comment on column public.tasks.archived_at is 'Soft archive marker. Tasks with children or financial operations should be archived instead of physically deleted.';
comment on column public.tasks.completed_at is 'Set automatically when status becomes completed and cleared when work resumes.';
