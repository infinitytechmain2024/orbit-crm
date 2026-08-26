-- Local self-hosted development providers and isolated development runs.
-- Providers never receive a Supabase service key; the trusted FastAPI backend
-- performs all mutations and exposes a narrow provider protocol.

create table public.development_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  provider_type text not null default 'self_hosted_docker'
    check (provider_type in ('self_hosted_docker')),
  platform text not null check (char_length(platform) between 1 and 80),
  architecture text not null check (char_length(architecture) between 1 and 40),
  capabilities text[] not null default '{}',
  status text not null default 'connecting'
    check (status in ('offline','connecting','available','busy','draining','degraded','disabled')),
  max_concurrent_runs integer not null default 1 check (max_concurrent_runs between 1 and 8),
  active_runs integer not null default 0 check (active_runs >= 0),
  last_heartbeat_at timestamptz,
  token_hash text not null check (char_length(token_hash) = 64),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index development_providers_status_idx
  on public.development_providers(organization_id, status, last_heartbeat_at desc);

create table public.development_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_run_id uuid not null,
  provider_id uuid references public.development_providers(id) on delete set null,
  repository text not null check (char_length(repository) between 1 and 500),
  base_branch text not null check (char_length(base_branch) between 1 and 200),
  base_commit text not null check (char_length(base_commit) between 7 and 64),
  working_branch text not null check (char_length(working_branch) between 1 and 240),
  status text not null default 'queued'
    check (status in (
      'queued','leased','preparing','running','controller_review','qa',
      'awaiting_approval','approved','pushing','preview_deployed','verified','completed',
      'waiting_for_provider','waiting_for_model','waiting_for_dependency',
      'revision_required','paused','failed','cancelled','rolled_back'
    )),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  lease_token_hash text,
  leased_until timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  exit_code integer,
  error_class text,
  result_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index development_runs_ready_idx
  on public.development_runs(status, created_at)
  where status in ('queued','waiting_for_provider');
create index development_runs_provider_idx
  on public.development_runs(provider_id, status, leased_until);
create index development_runs_workflow_idx
  on public.development_runs(organization_id, workflow_run_id, created_at desc);

create table public.development_run_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_run_id uuid not null references public.development_runs(id) on delete cascade,
  agent_id uuid,
  event_type text not null check (char_length(event_type) between 1 and 80),
  message text not null default '',
  model_id text,
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index development_run_events_run_idx
  on public.development_run_events(development_run_id, created_at, id);
create index development_run_events_org_idx
  on public.development_run_events(organization_id, created_at desc);

alter table public.development_providers enable row level security;
alter table public.development_runs enable row level security;
alter table public.development_run_events enable row level security;

create policy development_providers_member_select
  on public.development_providers for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy development_runs_member_select
  on public.development_runs for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy development_run_events_member_select
  on public.development_run_events for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

revoke all on public.development_providers, public.development_runs,
  public.development_run_events from anon, authenticated;
grant select on public.development_providers, public.development_runs,
  public.development_run_events to authenticated;
grant all on public.development_providers, public.development_runs,
  public.development_run_events to service_role;
grant usage, select on sequence public.development_run_events_id_seq to service_role;

create trigger set_development_providers_updated_at
  before update on public.development_providers
  for each row execute function public.set_updated_at();
create trigger set_development_runs_updated_at
  before update on public.development_runs
  for each row execute function public.set_updated_at();

create or replace function public.claim_selfdev_development_run(
  p_provider_id uuid,
  p_lease_seconds integer default 90
)
returns setof public.development_runs
language sql
security invoker
set search_path = ''
as $$
  update public.development_runs run
  set provider_id = p_provider_id,
      status = 'leased',
      leased_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
      attempt = run.attempt + 1,
      updated_at = now()
  where run.id = (
    select candidate.id
    from public.development_runs candidate
    join public.development_providers provider
      on provider.id = p_provider_id
     and provider.organization_id = candidate.organization_id
    where candidate.status in ('queued','waiting_for_provider')
      and provider.status in ('available','busy')
      and provider.active_runs < provider.max_concurrent_runs
      and (candidate.provider_id is null or candidate.provider_id = p_provider_id)
    order by candidate.created_at
    for update of candidate skip locked
    limit 1
  )
  returning run.*;
$$;

revoke all on function public.claim_selfdev_development_run(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_selfdev_development_run(uuid, integer)
  to service_role;

comment on table public.development_providers is
  'Registered self-hosted development execution providers; credentials are represented only by hashes.';
comment on table public.development_runs is
  'Isolated Git worktree/container executions for controlled self-development.';
