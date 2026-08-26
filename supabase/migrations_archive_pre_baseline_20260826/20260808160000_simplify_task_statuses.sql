-- Migration: 20260808160000_simplify_task_statuses.sql
-- Simplify task statuses to: backlog ('Входящие'), in_progress ('В работе'), review ('На проверке'), completed ('Завершено')

-- 1. Migrate existing tasks to one of the 4 simplified statuses
update public.tasks
set status = case
  when status in ('planned', 'blocked') then 'backlog'
  when status = 'cancelled' then 'completed'
  else status
end
where status in ('planned', 'blocked', 'cancelled');

-- 2. Drop old check constraint if exists
alter table public.tasks
  drop constraint if exists tasks_status_allowed_check;

-- 3. Add updated check constraint with 4 statuses
alter table public.tasks
  add constraint tasks_status_allowed_check
  check (
    status in (
      'backlog',
      'in_progress',
      'review',
      'completed'
    )
  );

-- 4. Update enum type public.task_status if present
do $$
begin
  if exists (select 1 from pg_type where typname = 'task_status' and typnamespace = 'public'::regnamespace) then
    alter table public.tasks alter column status drop default;
    alter table public.tasks alter column status type text;

    drop type public.task_status;

    create type public.task_status as enum (
      'backlog',
      'in_progress',
      'review',
      'completed'
    );

    alter table public.tasks 
      alter column status type public.task_status using status::public.task_status,
      alter column status set default 'backlog'::public.task_status;
  end if;
end $$;
