-- Recovery migration: restore Orbit Commander objects omitted from the remote
-- baseline. Legacy graph functions/views are intentionally excluded because
-- the remote database already uses the newer text-based Knowledge Graph v2.
-- Orbit Commander MVP
--
-- This migration extends the existing AI Workflow tables without renaming
-- them, so deployed Lovable clients remain compatible. Browser users retain
-- read-only access to orchestration state; authenticated mutations continue
-- through the FastAPI backend after membership/RBAC checks.

alter table public.ai_agents
  drop constraint if exists ai_agents_status_check;

alter table public.ai_agents
  add constraint ai_agents_status_check
  check (status in ('idle', 'assigned', 'working', 'blocked', 'review', 'completed')),
  add column if not exists system_instruction text not null default '',
  add column if not exists allowed_tools text[] not null default '{}',
  add column if not exists access_level text not null default 'internal'
    check (access_level in ('read_only', 'internal', 'elevated', 'approval_only')),
  add column if not exists max_concurrent_runs smallint not null default 1
    check (max_concurrent_runs between 1 and 20);

alter table public.ai_tasks
  drop constraint if exists ai_tasks_status_check;

alter table public.ai_tasks
  add constraint ai_tasks_status_check
  check (
    status in (
      'planning',
      'queued',
      'in_progress',
      'paused',
      'review',
      'approval_required',
      'done',
      'blocked',
      'revisions_requested',
      'cancelled'
    )
  ),
  add column if not exists original_request text not null default '',
  add column if not exists source text not null default 'manual'
    check (source in ('text', 'voice', 'manual', 'project', 'note', 'client', 'api')),
  add column if not exists source_entity_type text,
  add column if not exists source_entity_id uuid,
  add column if not exists risk_level text not null default 'low'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  add column if not exists approval_required boolean not null default false,
  add column if not exists goal text not null default '',
  add column if not exists acceptance_criteria jsonb not null default '[]'::jsonb,
  add column if not exists execution_plan jsonb not null default '{}'::jsonb,
  add column if not exists assumptions jsonb not null default '[]'::jsonb,
  add column if not exists blocker_reason text,
  add column if not exists qa_status text not null default 'pending'
    check (qa_status in ('pending', 'running', 'passed', 'failed', 'not_required')),
  add column if not exists qa_report jsonb,
  add column if not exists attempt_count integer not null default 0
    check (attempt_count >= 0),
  add column if not exists max_attempts integer not null default 3
    check (max_attempts between 1 and 10),
  add column if not exists timeout_seconds integer not null default 900
    check (timeout_seconds between 30 and 86400),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update public.ai_tasks
set original_request = coalesce(nullif(original_request, ''), title),
    goal = coalesce(nullif(goal, ''), title),
    approval_required = coalesce(
      (input_data ->> 'requires_approval')::boolean,
      approval_required,
      false
    )
where original_request = '' or goal = '';

alter table public.approval_requests
  drop constraint if exists approval_requests_status_check;

alter table public.approval_requests
  add constraint approval_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'changes_requested', 'cancelled')),
  add column if not exists action text not null default 'Подтвердить критическое действие',
  add column if not exists reason text not null default '',
  add column if not exists risk text not null default 'high'
    check (risk in ('low', 'medium', 'high', 'critical')),
  add column if not exists executor text,
  add column if not exists estimated_cost numeric(14, 4)
    check (estimated_cost is null or estimated_cost >= 0),
  add column if not exists currency text not null default 'EUR'
    check (currency ~ '^[A-Z]{3}$'),
  add column if not exists consequences text not null default '',
  add column if not exists decision_by uuid references auth.users(id) on delete set null;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '',
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_.]{2,79}$'),
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null,
  permission_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id),
  foreign key (organization_id, role_id)
    references public.roles(organization_id, id) on delete cascade,
  foreign key (organization_id, permission_id)
    references public.permissions(organization_id, id) on delete cascade
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '',
  version integer not null default 1 check (version > 0),
  definition jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name, version),
  unique (organization_id, id)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid,
  root_task_id uuid not null,
  status text not null default 'planning'
    check (status in ('planning', 'queued', 'running', 'paused', 'review', 'awaiting_approval', 'completed', 'blocked', 'cancelled', 'failed')),
  commander_state jsonb not null default '{}'::jsonb,
  progress smallint not null default 0 check (progress between 0 and 100),
  current_phase text not null default 'analysis',
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, workflow_id)
    references public.workflows(organization_id, id) on delete restrict,
  foreign key (organization_id, root_task_id)
    references public.ai_tasks(organization_id, id) on delete cascade,
  unique (organization_id, root_task_id),
  unique (organization_id, id)
);

alter table public.ai_tasks
  add column if not exists workflow_run_id uuid;

alter table public.ai_tasks
  add constraint ai_tasks_workflow_run_fkey
  foreign key (organization_id, workflow_run_id)
  references public.workflow_runs(organization_id, id)
  on delete set null;

create table public.task_dependencies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  dependency_type text not null default 'finish_to_start'
    check (dependency_type in ('finish_to_start', 'start_to_start', 'related')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  primary key (task_id, depends_on_task_id),
  foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, depends_on_task_id)
    references public.ai_tasks(organization_id, id) on delete cascade,
  check (task_id <> depends_on_task_id)
);

create table public.agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null,
  capability text not null check (char_length(trim(capability)) between 1 and 80),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, agent_id)
    references public.ai_agents(organization_id, id) on delete cascade,
  unique (organization_id, agent_id, capability)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_run_id uuid not null,
  task_id uuid not null,
  agent_id uuid not null,
  status text not null default 'assigned'
    check (status in ('assigned', 'working', 'blocked', 'review', 'completed', 'failed', 'cancelled')),
  phase text not null default 'execution',
  attempt integer not null default 1 check (attempt between 1 and 20),
  provider text,
  model text,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_snapshot jsonb,
  error jsonb,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  estimated_cost numeric(14, 6) not null default 0 check (estimated_cost >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, workflow_run_id)
    references public.workflow_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, agent_id)
    references public.ai_agents(organization_id, id) on delete restrict,
  unique (organization_id, id)
);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_run_id uuid not null,
  task_id uuid not null,
  agent_run_id uuid,
  sender_agent_id uuid,
  recipient_agent_id uuid,
  message_type text not null default 'status'
    check (message_type in ('instruction', 'status', 'result', 'review', 'blocker')),
  content text not null check (char_length(trim(content)) between 1 and 12000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, workflow_run_id)
    references public.workflow_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id) on delete cascade,
  foreign key (organization_id, agent_run_id)
    references public.agent_runs(organization_id, id) on delete set null,
  foreign key (organization_id, sender_agent_id)
    references public.ai_agents(organization_id, id) on delete restrict,
  foreign key (organization_id, recipient_agent_id)
    references public.ai_agents(organization_id, id) on delete restrict
);

create table public.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_run_id uuid not null,
  task_id uuid not null,
  job_type text not null check (job_type in ('plan', 'execute', 'qa', 'finalize')),
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  timeout_seconds integer not null default 900 check (timeout_seconds between 30 and 86400),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, workflow_run_id)
    references public.workflow_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id) on delete cascade,
  unique (organization_id, idempotency_key)
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service text not null check (char_length(trim(service)) between 1 and 80),
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'pending', 'connected', 'error', 'revoked')),
  owner_id uuid references auth.users(id) on delete set null,
  config_metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, service),
  unique (organization_id, id)
);

create table public.credentials_metadata (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null,
  service text not null,
  owner_id uuid references auth.users(id) on delete set null,
  secret_reference text not null check (secret_reference !~* '(key|token|secret)=') ,
  status text not null default 'active'
    check (status in ('active', 'expiring', 'expired', 'revoked')),
  last_rotated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, integration_id, secret_reference),
  foreign key (organization_id, integration_id)
    references public.integrations(organization_id, id) on delete cascade
);

create table public.audit_logs (
  id bigint generated by default as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  action text not null check (char_length(trim(action)) between 1 and 120),
  entity_type text not null check (char_length(trim(entity_type)) between 1 and 80),
  entity_id uuid,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  type text not null check (char_length(trim(type)) between 1 and 80),
  title text not null check (char_length(trim(title)) between 1 and 180),
  body text not null default '',
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index roles_org_idx on public.roles(organization_id, code);
create index permissions_org_idx on public.permissions(organization_id, code);
create index role_permissions_org_idx on public.role_permissions(organization_id, role_id);
create index workflow_runs_status_idx
  on public.workflow_runs(organization_id, status, updated_at desc);
create index ai_tasks_workflow_idx
  on public.ai_tasks(organization_id, workflow_run_id, status, updated_at desc);
create index task_dependencies_waiting_idx
  on public.task_dependencies(organization_id, task_id, is_required);
create index task_dependencies_upstream_idx
  on public.task_dependencies(organization_id, depends_on_task_id);
create index agent_capabilities_lookup_idx
  on public.agent_capabilities(organization_id, capability, agent_id);
create index agent_runs_task_idx
  on public.agent_runs(organization_id, task_id, created_at desc);
create index agent_runs_active_idx
  on public.agent_runs(organization_id, agent_id, status)
  where status in ('assigned', 'working', 'review');
create index agent_messages_timeline_idx
  on public.agent_messages(organization_id, workflow_run_id, created_at desc);
create index workflow_jobs_ready_idx
  on public.workflow_jobs(status, available_at, created_at)
  where status = 'queued';
create index workflow_jobs_run_idx
  on public.workflow_jobs(organization_id, workflow_run_id, status);
create index credentials_metadata_integration_idx
  on public.credentials_metadata(organization_id, integration_id);
create index audit_logs_entity_idx
  on public.audit_logs(organization_id, entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx
  on public.audit_logs(organization_id, actor_type, actor_id, created_at desc);
create index notifications_unread_idx
  on public.notifications(organization_id, recipient_user_id, created_at desc)
  where read_at is null;

create trigger set_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();
create trigger set_workflows_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();
create trigger set_workflow_runs_updated_at
  before update on public.workflow_runs
  for each row execute function public.set_updated_at();
create trigger set_agent_runs_updated_at
  before update on public.agent_runs
  for each row execute function public.set_updated_at();
create trigger set_workflow_jobs_updated_at
  before update on public.workflow_jobs
  for each row execute function public.set_updated_at();
create trigger set_integrations_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();
create trigger set_credentials_metadata_updated_at
  before update on public.credentials_metadata
  for each row execute function public.set_updated_at();

create or replace function public.claim_workflow_job(p_worker_id text)
returns setof public.workflow_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.workflow_jobs job
  set status = 'leased',
      locked_at = now(),
      locked_by = left(p_worker_id, 120),
      attempts = job.attempts + 1,
      updated_at = now()
  where job.id = (
    select candidate.id
    from public.workflow_jobs candidate
    join public.workflow_runs run
      on run.organization_id = candidate.organization_id
     and run.id = candidate.workflow_run_id
    where candidate.status = 'queued'
      and candidate.available_at <= now()
      and run.status not in ('paused', 'cancelled', 'completed', 'failed')
    order by candidate.available_at, candidate.created_at
    for update of candidate skip locked
    limit 1
  )
  returning job.*;
$$;

revoke execute on function public.claim_workflow_job(text) from public, anon, authenticated;
grant execute on function public.claim_workflow_job(text) to service_role;

-- The legacy RPC could mark a task done without QA. New approvals are resolved
-- through Orbit Commander, so remove direct execution from the service role.
revoke execute on function public.resolve_ai_approval(uuid, uuid, text, text)
  from service_role;

create or replace view public.users
with (security_invoker = true)
as select id, email, full_name, avatar_url, created_at, updated_at from public.profiles;

create or replace view public.agents
with (security_invoker = true)
as select * from public.ai_agents;

create or replace view public.task_artifacts
with (security_invoker = true)
as select * from public.artifacts;

create or replace view public.approvals
with (security_invoker = true)
as select * from public.approval_requests;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.agent_capabilities enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_messages enable row level security;
alter table public.workflow_jobs enable row level security;
alter table public.integrations enable row level security;
alter table public.credentials_metadata enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

create policy "Members can read roles" on public.roles for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read permissions" on public.permissions for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read role permissions" on public.role_permissions for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read workflows" on public.workflows for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read workflow runs" on public.workflow_runs for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read task dependencies" on public.task_dependencies for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read agent capabilities" on public.agent_capabilities for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read agent runs" on public.agent_runs for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read agent messages" on public.agent_messages for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read workflow jobs" on public.workflow_jobs for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read integrations" on public.integrations for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read credential metadata" on public.credentials_metadata for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read audit logs" on public.audit_logs for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
create policy "Members can read notifications" on public.notifications for select to authenticated
  using (
    private.is_organization_member(organization_id, (select auth.uid()))
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
  );

revoke all on table public.roles from anon, authenticated;
revoke all on table public.permissions from anon, authenticated;
revoke all on table public.role_permissions from anon, authenticated;
revoke all on table public.workflows from anon, authenticated;
revoke all on table public.workflow_runs from anon, authenticated;
revoke all on table public.task_dependencies from anon, authenticated;
revoke all on table public.agent_capabilities from anon, authenticated;
revoke all on table public.agent_runs from anon, authenticated;
revoke all on table public.agent_messages from anon, authenticated;
revoke all on table public.workflow_jobs from anon, authenticated;
revoke all on table public.integrations from anon, authenticated;
revoke all on table public.credentials_metadata from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;

grant select on table public.roles to authenticated;
grant select on table public.permissions to authenticated;
grant select on table public.role_permissions to authenticated;
grant select on table public.workflows to authenticated;
grant select on table public.workflow_runs to authenticated;
grant select on table public.task_dependencies to authenticated;
grant select on table public.agent_capabilities to authenticated;
grant select on table public.agent_runs to authenticated;
grant select on table public.agent_messages to authenticated;
grant select on table public.workflow_jobs to authenticated;
grant select on table public.integrations to authenticated;
grant select on table public.credentials_metadata to authenticated;
grant select on table public.audit_logs to authenticated;
grant select on table public.notifications to authenticated;

grant select, insert, update, delete on table public.roles to service_role;
grant select, insert, update, delete on table public.permissions to service_role;
grant select, insert, update, delete on table public.role_permissions to service_role;
grant select, insert, update, delete on table public.workflows to service_role;
grant select, insert, update, delete on table public.workflow_runs to service_role;
grant select, insert, update, delete on table public.task_dependencies to service_role;
grant select, insert, update, delete on table public.agent_capabilities to service_role;
grant select, insert, update, delete on table public.agent_runs to service_role;
grant select, insert, update, delete on table public.agent_messages to service_role;
grant select, insert, update, delete on table public.workflow_jobs to service_role;
grant select, insert, update, delete on table public.integrations to service_role;
grant select, insert, update, delete on table public.credentials_metadata to service_role;
grant select, insert, update, delete on table public.audit_logs to service_role;
grant select, insert, update, delete on table public.notifications to service_role;
grant usage, select on sequence public.audit_logs_id_seq to service_role;

revoke all on table public.users from anon, authenticated;
revoke all on table public.agents from anon, authenticated;
revoke all on table public.task_artifacts from anon, authenticated;
revoke all on table public.approvals from anon, authenticated;
revoke all on table public.knowledge_edges from anon, authenticated;
revoke all on table public.knowledge_nodes from anon, authenticated;
grant select on table public.users to authenticated, service_role;
grant select on table public.agents to authenticated, service_role;
grant select on table public.task_artifacts to authenticated, service_role;
grant select on table public.approvals to authenticated, service_role;
grant select on table public.knowledge_edges to authenticated, service_role;
grant select on table public.knowledge_nodes to authenticated, service_role;

-- Seed organization-scoped RBAC definitions used by the backend API.
insert into public.roles (organization_id, code, name, description)
select org.id, seed.code, seed.name, seed.description
from public.organizations org
cross join (
  values
    ('owner', 'Владелец', 'Полный контроль и бизнес-критические решения'),
    ('admin', 'Администратор', 'Управление командой, workflow и интеграциями'),
    ('manager', 'Менеджер', 'Управление проектами и задачами'),
    ('accountant', 'Финансы', 'Финансовые операции и отчёты'),
    ('member', 'Участник', 'Создание и выполнение внутренних задач')
) as seed(code, name, description)
on conflict (organization_id, code) do nothing;

insert into public.permissions (organization_id, code, description)
select org.id, seed.code, seed.description
from public.organizations org
cross join (
  values
    ('workflow.read', 'Просмотр AI workflow'),
    ('workflow.create', 'Создание AI-задач'),
    ('workflow.control', 'Пауза, возобновление, отмена и retry'),
    ('approval.decide', 'Решение по критическим действиям'),
    ('agents.manage', 'Управление AI-агентами'),
    ('integrations.manage', 'Управление внешними интеграциями'),
    ('access.manage', 'Управление доступами')
) as seed(code, description)
on conflict (organization_id, code) do nothing;

insert into public.role_permissions (organization_id, role_id, permission_id)
select role.organization_id, role.id, permission.id
from public.roles role
join public.permissions permission on permission.organization_id = role.organization_id
where
  role.code in ('owner', 'admin')
  or (role.code = 'manager' and permission.code in ('workflow.read', 'workflow.create', 'workflow.control'))
  or (role.code in ('member', 'accountant') and permission.code in ('workflow.read', 'workflow.create'))
on conflict (role_id, permission_id) do nothing;

create or replace function private.bootstrap_orbit_rbac()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.roles (organization_id, code, name, description)
  select new.id, seed.code, seed.name, seed.description
  from (values
    ('owner', 'Владелец', 'Полный контроль и бизнес-критические решения'),
    ('admin', 'Администратор', 'Управление командой, workflow и интеграциями'),
    ('manager', 'Менеджер', 'Управление проектами и задачами'),
    ('accountant', 'Финансы', 'Финансовые операции и отчёты'),
    ('member', 'Участник', 'Создание и выполнение внутренних задач')
  ) as seed(code, name, description)
  on conflict (organization_id, code) do nothing;

  insert into public.permissions (organization_id, code, description)
  select new.id, seed.code, seed.description
  from (values
    ('workflow.read', 'Просмотр AI workflow'),
    ('workflow.create', 'Создание AI-задач'),
    ('workflow.control', 'Пауза, возобновление, отмена и retry'),
    ('approval.decide', 'Решение по критическим действиям'),
    ('agents.manage', 'Управление AI-агентами'),
    ('integrations.manage', 'Управление внешними интеграциями'),
    ('access.manage', 'Управление доступами')
  ) as seed(code, description)
  on conflict (organization_id, code) do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_id)
  select role.organization_id, role.id, permission.id
  from public.roles role
  join public.permissions permission on permission.organization_id = role.organization_id
  where role.organization_id = new.id
    and (
      role.code in ('owner', 'admin')
      or (role.code = 'manager' and permission.code in ('workflow.read', 'workflow.create', 'workflow.control'))
      or (role.code in ('member', 'accountant') and permission.code in ('workflow.read', 'workflow.create'))
    )
  on conflict (role_id, permission_id) do nothing;
  return new;
end;
$$;

drop trigger if exists bootstrap_orbit_rbac_on_organization on public.organizations;
create trigger bootstrap_orbit_rbac_on_organization
  after insert on public.organizations
  for each row execute function private.bootstrap_orbit_rbac();

revoke execute on function private.bootstrap_orbit_rbac() from public, anon, authenticated;

insert into public.agent_capabilities (organization_id, agent_id, capability)
select agent.organization_id, agent.id, capability
from public.ai_agents agent
cross join lateral unnest(agent.capabilities) capability
on conflict (organization_id, agent_id, capability) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workflow_runs',
    'task_dependencies',
    'agent_runs',
    'agent_messages',
    'workflow_jobs',
    'audit_logs',
    'notifications'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

comment on table public.workflow_jobs is
  'Durable, retryable queue consumed by Orbit Commander workers.';
comment on table public.credentials_metadata is
  'Metadata and secret-manager references only; never stores API secret values.';
comment on table public.agent_runs is
  'Reproducible execution record for one specialized-agent attempt.';
