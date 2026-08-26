update public.tasks as task
set sort_order = ranked.sort_order
from (
  select
    id,
    (row_number() over (
      partition by organization_id, status
      order by created_at desc, id
    ) * 1024)::numeric(14,4) as sort_order
  from public.tasks
) as ranked
where task.id = ranked.id
  and task.sort_order = 0;

create index if not exists tasks_organization_status_sort_order_idx
  on public.tasks(organization_id, status, sort_order, id)
  where archived_at is null;

create index if not exists tasks_organization_due_open_idx
  on public.tasks(organization_id, due_date)
  where archived_at is null
    and status not in ('completed', 'cancelled');

create index if not exists tasks_organization_project_status_idx
  on public.tasks(organization_id, project_id, status)
  where archived_at is null;

create index if not exists tasks_organization_priority_idx
  on public.tasks(organization_id, priority)
  where archived_at is null;

create index if not exists tasks_organization_assignee_idx
  on public.tasks(organization_id, assignee_id)
  where archived_at is null;

create index if not exists tasks_tags_idx
  on public.tasks using gin(tags);

create table if not exists public.task_view_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_view text not null default 'kanban',
  filters jsonb not null default '{}'::jsonb,
  list_columns text[] not null default array[
    'title',
    'project',
    'status',
    'priority',
    'dueDate',
    'assignee',
    'checklist',
    'blocked'
  ]::text[],
  sort_key text not null default 'updatedAt',
  sort_direction text not null default 'desc',
  page_size integer not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint task_view_preferences_selected_view_check
    check (selected_view in ('kanban', 'list')),
  constraint task_view_preferences_filters_object_check
    check (jsonb_typeof(filters) = 'object'),
  constraint task_view_preferences_sort_direction_check
    check (sort_direction in ('asc', 'desc')),
  constraint task_view_preferences_page_size_check
    check (page_size >= 10 and page_size <= 100)
);

drop trigger if exists set_task_view_preferences_updated_at
  on public.task_view_preferences;
create trigger set_task_view_preferences_updated_at
  before update on public.task_view_preferences
  for each row execute function public.set_updated_at();

alter table public.task_view_preferences enable row level security;

drop policy if exists "Users can read their task view preferences"
  on public.task_view_preferences;
create policy "Users can read their task view preferences"
  on public.task_view_preferences
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

drop policy if exists "Users can create their task view preferences"
  on public.task_view_preferences;
create policy "Users can create their task view preferences"
  on public.task_view_preferences
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

drop policy if exists "Users can update their task view preferences"
  on public.task_view_preferences;
create policy "Users can update their task view preferences"
  on public.task_view_preferences
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

drop policy if exists "Users can delete their task view preferences"
  on public.task_view_preferences;
create policy "Users can delete their task view preferences"
  on public.task_view_preferences
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

revoke all privileges on table public.task_view_preferences from anon;
revoke all privileges on table public.task_view_preferences from authenticated;
grant select, insert, update, delete on table public.task_view_preferences to authenticated;

comment on table public.task_view_preferences is 'Per-user task view, filter, column, and sorting preferences.';
