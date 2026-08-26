-- The queue row references its calendar event, so synchronization must run after insert.
create or replace function public.prepare_calendar_event_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.starts_at is distinct from old.starts_at
     and new.reminder_at is not null
     and new.reminder_at is not distinct from old.reminder_at then
    new.reminder_at := new.reminder_at + (new.starts_at - old.starts_at);
  end if;
  if tg_op = 'INSERT'
     or new.reminder_at is distinct from old.reminder_at
     or new.status is distinct from old.status then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.sync_calendar_event_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reminder_at is null or new.status = 'cancelled' then
    update public.calendar_reminders
       set status = 'cancelled', updated_at = now()
     where event_id = new.id
       and status in ('queued','processing','failed');
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.reminder_at is distinct from old.reminder_at
     or (new.status is distinct from old.status and old.status = 'cancelled') then
    insert into public.calendar_reminders (organization_id,event_id,channel,scheduled_for,status)
    values (new.organization_id,new.id,'in_app',new.reminder_at,'queued')
    on conflict (event_id,channel) do update
      set organization_id=excluded.organization_id,
          scheduled_for=excluded.scheduled_for,
          status='queued', attempt_count=0, last_error=null,
          delivered_at=null, updated_at=now();
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_calendar_event_reminder() from public, anon, authenticated;
revoke all on function public.sync_calendar_event_reminder() from public, anon, authenticated;

drop trigger if exists sync_calendar_event_reminder on public.calendar_events;
drop trigger if exists prepare_calendar_event_reminder on public.calendar_events;
create trigger prepare_calendar_event_reminder
before insert or update of reminder_at,status,starts_at on public.calendar_events
for each row execute function public.prepare_calendar_event_reminder();
create trigger sync_calendar_event_reminder
after insert or update of reminder_at,status,starts_at on public.calendar_events
for each row execute function public.sync_calendar_event_reminder();
;
