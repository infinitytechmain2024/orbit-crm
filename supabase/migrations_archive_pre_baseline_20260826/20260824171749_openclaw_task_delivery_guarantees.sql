-- Durable correlation and exactly-once state transitions for OpenClaw delivery.

alter table public.openclaw_tasks
  add column if not exists correlation_id uuid;

update public.openclaw_tasks
set correlation_id = gen_random_uuid()
where correlation_id is null;

alter table public.openclaw_tasks
  alter column correlation_id set default gen_random_uuid(),
  alter column correlation_id set not null;

create unique index if not exists openclaw_tasks_org_correlation_uidx
  on public.openclaw_tasks(organization_id, correlation_id);

create table if not exists public.openclaw_webhook_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.openclaw_tasks(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload_digest text not null check (char_length(payload_digest) = 64),
  requested_status text not null,
  applied boolean not null default false,
  received_at timestamptz not null default now(),
  unique(task_id, idempotency_key)
);

create index if not exists openclaw_webhook_events_org_received_idx
  on public.openclaw_webhook_events(organization_id, received_at desc);

alter table public.openclaw_webhook_events enable row level security;
revoke all on public.openclaw_webhook_events from anon, authenticated;
grant all on public.openclaw_webhook_events to service_role;

create or replace function public.apply_openclaw_task_webhook(
  p_task_id uuid,
  p_idempotency_key text,
  p_payload_digest text,
  p_status text,
  p_result jsonb default null,
  p_error text default null
)
returns table(applied boolean, duplicate boolean, organization_id uuid, correlation_id uuid, current_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.openclaw_tasks%rowtype;
  event_id bigint;
  should_apply boolean;
begin
  if p_status not in ('pending','queued','processing','completed','error','cancelled') then
    raise exception 'Invalid OpenClaw task status' using errcode = '22023';
  end if;
  if char_length(p_idempotency_key) not between 8 and 200 or char_length(p_payload_digest) <> 64 then
    raise exception 'Invalid webhook idempotency metadata' using errcode = '22023';
  end if;

  select * into task_row from public.openclaw_tasks where id = p_task_id for update;
  if not found then return; end if;

  insert into public.openclaw_webhook_events(
    organization_id, task_id, idempotency_key, payload_digest, requested_status
  ) values (
    task_row.organization_id, p_task_id, p_idempotency_key, p_payload_digest, p_status
  ) on conflict (task_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    return query select false, true, task_row.organization_id,
      task_row.correlation_id, task_row.status;
    return;
  end if;

  should_apply := task_row.status not in ('completed','error','cancelled');
  if should_apply then
    update public.openclaw_tasks
    set status = p_status,
        result = case when p_result is not null then p_result else result end,
        error = case when p_error is not null then p_error else error end,
        updated_at = now()
    where id = p_task_id;
    update public.openclaw_webhook_events set applied = true where id = event_id;
  end if;

  return query select should_apply, false, task_row.organization_id,
    task_row.correlation_id, case when should_apply then p_status else task_row.status end;
end;
$$;

revoke all on function public.apply_openclaw_task_webhook(uuid,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.apply_openclaw_task_webhook(uuid,text,text,text,jsonb,text) to service_role;;
