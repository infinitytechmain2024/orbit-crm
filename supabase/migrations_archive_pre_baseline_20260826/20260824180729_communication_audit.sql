create table public.communication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  channel text not null check (channel in ('email','telegram')),
  direction text not null check (direction in ('inbound','outbound')),
  action text not null check (action in ('send','reply','webhook','classify','create_task')),
  status text not null check (status in ('processing','sent','received','failed')),
  provider_message_id text,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 240),
  recipient text,
  subject text,
  source text not null default 'user' check (source in ('user','openclaw','automation','provider_webhook')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  error text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, idempotency_key)
);

create index communication_events_org_created_idx
  on public.communication_events(organization_id, created_at desc);
create index communication_events_provider_message_idx
  on public.communication_events(provider_message_id)
  where provider_message_id is not null;
create index communication_events_user_idx
  on public.communication_events(user_id)
  where user_id is not null;

alter table public.communication_events enable row level security;
create policy communication_events_member_read on public.communication_events
  for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

revoke all on public.communication_events from anon, authenticated;
grant select on public.communication_events to authenticated;
grant all on public.communication_events to service_role;
;
