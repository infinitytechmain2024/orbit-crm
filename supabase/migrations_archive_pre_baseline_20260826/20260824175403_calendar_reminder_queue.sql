create extension if not exists pg_cron with schema pg_catalog;

create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app')),
  scheduled_for timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued','processing','delivered','cancelled','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, channel),
  unique (organization_id, id)
);

create index calendar_reminders_due_idx
  on public.calendar_reminders(scheduled_for, id)
  where status = 'queued';
create index calendar_reminders_org_event_idx
  on public.calendar_reminders(organization_id, event_id);

create table public.calendar_reminder_deliveries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reminder_id uuid not null references public.calendar_reminders(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  channel text not null check (channel in ('in_app')),
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('delivered','failed')),
  error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reminder_id, attempt_number)
);

create index calendar_reminder_deliveries_org_created_idx
  on public.calendar_reminder_deliveries(organization_id, created_at desc);

alter table public.calendar_reminders enable row level security;
alter table public.calendar_reminder_deliveries enable row level security;

create policy calendar_reminders_member_read on public.calendar_reminders
  for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy calendar_reminder_deliveries_member_read on public.calendar_reminder_deliveries
  for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

revoke all on public.calendar_reminders, public.calendar_reminder_deliveries from anon, authenticated;
grant select on public.calendar_reminders, public.calendar_reminder_deliveries to authenticated;

create or replace function public.sync_calendar_event_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.starts_at is distinct from old.starts_at
     and new.reminder_at is not null
     and new.reminder_at is not distinct from old.reminder_at then
    new.reminder_at := new.reminder_at + (new.starts_at - old.starts_at);
  end if;

  if new.reminder_at is null or new.status = 'cancelled' then
    update public.calendar_reminders
       set status = 'cancelled', updated_at = now()
     where event_id = new.id
       and status in ('queued','processing','failed');
    new.reminder_sent_at := null;
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.reminder_at is distinct from old.reminder_at
     or (new.status is distinct from old.status and old.status = 'cancelled') then
    insert into public.calendar_reminders (
      organization_id, event_id, channel, scheduled_for, status
    ) values (
      new.organization_id, new.id, 'in_app', new.reminder_at, 'queued'
    )
    on conflict (event_id, channel) do update
      set organization_id = excluded.organization_id,
          scheduled_for = excluded.scheduled_for,
          status = 'queued',
          attempt_count = 0,
          last_error = null,
          delivered_at = null,
          updated_at = now();
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_calendar_event_reminder() from public, anon, authenticated;

drop trigger if exists sync_calendar_event_reminder on public.calendar_events;
create trigger sync_calendar_event_reminder
before insert or update of reminder_at, status, starts_at on public.calendar_events
for each row execute function public.sync_calendar_event_reminder();

create or replace function public.process_due_calendar_reminders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  processed_count integer;
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000';
  end if;

  with due as (
    select r.id
      from public.calendar_reminders r
      join public.calendar_events e on e.id = r.event_id
     where r.status = 'queued'
       and r.scheduled_for <= now()
       and e.status <> 'cancelled'
     order by r.scheduled_for, r.id
     for update of r skip locked
     limit p_limit
  ), updated as (
    update public.calendar_reminders r
       set status = 'delivered',
           attempt_count = r.attempt_count + 1,
           delivered_at = now(),
           last_error = null,
           updated_at = now()
      from due
     where r.id = due.id
    returning r.*
  ), logged as (
    insert into public.calendar_reminder_deliveries (
      organization_id, reminder_id, event_id, channel, attempt_number, status, delivered_at
    )
    select organization_id, id, event_id, channel, attempt_count, 'delivered', delivered_at
      from updated
    on conflict (reminder_id, attempt_number) do nothing
    returning reminder_id
  ), marked as (
    update public.calendar_events e
       set reminder_sent_at = u.delivered_at
      from updated u
     where e.id = u.event_id
    returning e.id
  )
  select count(*) into processed_count from logged;

  return processed_count;
end;
$$;

revoke all on function public.process_due_calendar_reminders(integer) from public, anon, authenticated;
grant execute on function public.process_due_calendar_reminders(integer) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'orbit-calendar-reminders';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'orbit-calendar-reminders',
    '* * * * *',
    'select public.process_due_calendar_reminders(100);'
  );
end $$;

-- Reconcile reminders configured before this migration without marking them delivered.
insert into public.calendar_reminders (organization_id, event_id, channel, scheduled_for, status)
select organization_id, id, 'in_app', reminder_at,
       case when status = 'cancelled' then 'cancelled' else 'queued' end
  from public.calendar_events
 where reminder_at is not null
on conflict (event_id, channel) do nothing;
;
