-- AI Workflow is organization-scoped so every realtime row remains tenant-safe.
-- The backend writes with the service role after authenticating the caller and
-- verifying organization membership. Browser clients receive SELECT only for
-- realtime subscriptions and read-only fallbacks.

create table public.ai_departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null default '#19d3c5',
  icon text not null default 'network',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  role text not null check (char_length(trim(role)) between 1 and 80),
  description text not null default '',
  status text not null default 'idle' check (status in ('working', 'idle', 'blocked')),
  capabilities text[] not null default '{}',
  default_model text,
  fallback_models text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_agents_department_fkey
    foreign key (organization_id, department_id)
    references public.ai_departments(organization_id, id)
    on delete restrict,
  unique (organization_id, role),
  unique (organization_id, id)
);

create table public.ai_model_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'nvidia' check (char_length(trim(provider)) between 1 and 40),
  model_name text not null check (char_length(trim(model_name)) between 1 and 180),
  capabilities text[] not null default '{}',
  priority smallint not null default 100 check (priority between 0 and 1000),
  is_enabled boolean not null default true,
  max_retries smallint not null default 1 check (max_retries between 0 and 5),
  config_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, model_name),
  unique (organization_id, id)
);

create table public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  department_id uuid,
  agent_id uuid,
  parent_task_id uuid references public.ai_tasks(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 240),
  description text not null default '',
  status text not null default 'queued' check (
    status in (
      'queued',
      'in_progress',
      'approval_required',
      'done',
      'blocked',
      'revisions_requested',
      'cancelled'
    )
  ),
  priority text not null default 'medium' check (
    priority in ('low', 'medium', 'high', 'critical')
  ),
  due_at timestamptz,
  input_data jsonb not null default '{}'::jsonb,
  result jsonb,
  current_model text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_tasks_project_fkey
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete restrict,
  constraint ai_tasks_department_fkey
    foreign key (organization_id, department_id)
    references public.ai_departments(organization_id, id)
    on delete restrict,
  constraint ai_tasks_agent_fkey
    foreign key (organization_id, agent_id)
    references public.ai_agents(organization_id, id)
    on delete restrict,
  unique (organization_id, id)
);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  project_id uuid,
  agent_id uuid,
  event_type text not null check (char_length(trim(event_type)) between 1 and 80),
  message text not null check (char_length(trim(message)) between 1 and 1000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_events_task_fkey
    foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id)
    on delete cascade,
  constraint task_events_project_fkey
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete restrict,
  constraint task_events_agent_fkey
    foreign key (organization_id, agent_id)
    references public.ai_agents(organization_id, id)
    on delete restrict
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  requested_by_agent_id uuid,
  assigned_to_agent_id uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_comment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint approval_requests_task_fkey
    foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id)
    on delete cascade,
  constraint approval_requests_requester_fkey
    foreign key (organization_id, requested_by_agent_id)
    references public.ai_agents(organization_id, id)
    on delete restrict,
  constraint approval_requests_assignee_fkey
    foreign key (organization_id, assigned_to_agent_id)
    references public.ai_agents(organization_id, id)
    on delete restrict
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  project_id uuid,
  agent_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 240),
  type text not null check (char_length(trim(type)) between 1 and 60),
  url text not null check (char_length(trim(url)) between 1 and 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint artifacts_task_fkey
    foreign key (organization_id, task_id)
    references public.ai_tasks(organization_id, id)
    on delete cascade,
  constraint artifacts_project_fkey
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete restrict,
  constraint artifacts_agent_fkey
    foreign key (organization_id, agent_id)
    references public.ai_agents(organization_id, id)
    on delete restrict
);

-- Foreign keys and the primary dashboard access paths are indexed explicitly.
create index ai_departments_organization_idx on public.ai_departments(organization_id);
create index ai_agents_department_idx on public.ai_agents(organization_id, department_id);
create index ai_agents_active_status_idx on public.ai_agents(organization_id, is_active, status);
create index ai_agents_capabilities_idx on public.ai_agents using gin(capabilities);
create index ai_model_configs_enabled_idx
  on public.ai_model_configs(organization_id, priority, model_name)
  where is_enabled;
create index ai_model_configs_capabilities_idx on public.ai_model_configs using gin(capabilities);
create index ai_tasks_project_status_idx
  on public.ai_tasks(organization_id, project_id, status, updated_at desc);
create index ai_tasks_department_status_idx
  on public.ai_tasks(organization_id, department_id, status, updated_at desc);
create index ai_tasks_agent_status_idx
  on public.ai_tasks(organization_id, agent_id, status, updated_at desc);
create index ai_tasks_parent_idx on public.ai_tasks(parent_task_id) where parent_task_id is not null;
create index task_events_timeline_idx
  on public.task_events(organization_id, created_at desc);
create index task_events_task_idx on public.task_events(task_id);
create unique index approval_requests_one_pending_per_task_idx
  on public.approval_requests(task_id)
  where status = 'pending';
create index approval_requests_queue_idx
  on public.approval_requests(organization_id, status, created_at);
create index approval_requests_requester_idx
  on public.approval_requests(requested_by_agent_id)
  where requested_by_agent_id is not null;
create index approval_requests_assignee_idx
  on public.approval_requests(assigned_to_agent_id)
  where assigned_to_agent_id is not null;
create index artifacts_timeline_idx on public.artifacts(organization_id, created_at desc);
create index artifacts_task_idx on public.artifacts(task_id);
create index artifacts_project_idx on public.artifacts(project_id) where project_id is not null;
create index artifacts_agent_idx on public.artifacts(agent_id) where agent_id is not null;

create trigger set_ai_departments_updated_at
  before update on public.ai_departments
  for each row execute function public.set_updated_at();

create trigger set_ai_agents_updated_at
  before update on public.ai_agents
  for each row execute function public.set_updated_at();

create trigger set_ai_model_configs_updated_at
  before update on public.ai_model_configs
  for each row execute function public.set_updated_at();

create trigger set_ai_tasks_updated_at
  before update on public.ai_tasks
  for each row execute function public.set_updated_at();

alter table public.ai_departments enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_model_configs enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.approval_requests enable row level security;
alter table public.artifacts enable row level security;

create policy "Members can read AI departments"
  on public.ai_departments for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read AI agents"
  on public.ai_agents for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read AI model configs"
  on public.ai_model_configs for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read AI tasks"
  on public.ai_tasks for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read task events"
  on public.task_events for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read approval requests"
  on public.approval_requests for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can read artifacts"
  on public.artifacts for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

revoke all on table public.ai_departments from anon, authenticated;
revoke all on table public.ai_agents from anon, authenticated;
revoke all on table public.ai_model_configs from anon, authenticated;
revoke all on table public.ai_tasks from anon, authenticated;
revoke all on table public.task_events from anon, authenticated;
revoke all on table public.approval_requests from anon, authenticated;
revoke all on table public.artifacts from anon, authenticated;

grant select on table public.ai_departments to authenticated;
grant select on table public.ai_agents to authenticated;
grant select on table public.ai_model_configs to authenticated;
grant select on table public.ai_tasks to authenticated;
grant select on table public.task_events to authenticated;
grant select on table public.approval_requests to authenticated;
grant select on table public.artifacts to authenticated;

grant select, insert, update, delete on table public.ai_departments to service_role;
grant select, insert, update, delete on table public.ai_agents to service_role;
grant select, insert, update, delete on table public.ai_model_configs to service_role;
grant select, insert, update, delete on table public.ai_tasks to service_role;
grant select, insert, update, delete on table public.task_events to service_role;
grant select, insert, update, delete on table public.approval_requests to service_role;
grant select, insert, update, delete on table public.artifacts to service_role;

-- Seed the three required CRM projects without duplicating an existing project.
insert into public.projects (
  organization_id,
  name,
  color,
  status,
  priority,
  owner_id,
  created_by
)
select
  org.id,
  seed.name,
  seed.color,
  seed.status::public.project_status,
  'medium'::public.project_priority,
  case
    when exists (
      select 1 from public.organization_members om
      where om.organization_id = org.id and om.user_id = org.created_by
    ) then org.created_by
    else null
  end,
  org.created_by
from public.organizations org
cross join (
  values
    ('Orbit CRM', '#19d3c5', 'active'),
    ('OSNOVA', '#8b7cf6', 'planned'),
    ('BERRDO', '#f3b63f', 'planned')
) as seed(name, color, status)
where not exists (
  select 1
  from public.projects project
  where project.organization_id = org.id
    and lower(trim(project.name)) = lower(seed.name)
);

insert into public.ai_departments (organization_id, name, color, icon)
select org.id, seed.name, seed.color, seed.icon
from public.organizations org
cross join (
  values
    ('Developer', '#23c7f4', 'code-2'),
    ('Marketer', '#19d3c5', 'megaphone'),
    ('HR', '#8b7cf6', 'users-round')
) as seed(name, color, icon)
on conflict (organization_id, name) do nothing;

insert into public.ai_agents (
  organization_id,
  department_id,
  name,
  role,
  description,
  capabilities,
  status
)
select
  org.id,
  department.id,
  seed.name,
  seed.role,
  seed.description,
  seed.capabilities,
  'idle'
from public.organizations org
cross join (
  values
    (null::text, 'CEO', 'CEO', 'Chief Executive Officer', array['reasoning', 'long_context']::text[]),
    ('Developer', 'Frontend', 'Frontend', 'Интерфейсы, компоненты, UX и адаптивность', array['coding', 'reasoning', 'vision']::text[]),
    ('Developer', 'Backend', 'Backend', 'API, серверная логика, база данных и авторизация', array['coding', 'reasoning', 'long_context']::text[]),
    ('Developer', 'QA / DevOps', 'QA / DevOps', 'Тесты, CI/CD, деплой и мониторинг', array['coding', 'analysis', 'fast']::text[]),
    ('Developer', 'AI Integrations', 'AI Integrations', 'Модели, промпты, инструменты и AI-пайплайны', array['coding', 'reasoning', 'long_context']::text[]),
    ('Marketer', 'CMO', 'CMO', 'Стратегия, позиционирование и планы роста', array['writing', 'analysis', 'reasoning']::text[]),
    ('Marketer', 'Sales Rep', 'Sales Rep', 'Лиды, предложения и продажи', array['writing', 'analysis', 'fast']::text[]),
    ('Marketer', 'SEO', 'SEO', 'Семантика, метаданные и контент-планы', array['writing', 'analysis', 'reasoning']::text[]),
    ('Marketer', 'SMM', 'SMM', 'Социальные сети, контент и публикации', array['writing', 'analysis', 'fast']::text[]),
    ('Marketer', 'Рассылка', 'Рассылка', 'Email-цепочки, сегментация и письма', array['writing', 'analysis', 'fast']::text[]),
    ('Marketer', 'Парсинг', 'Парсинг', 'Поиск и сбор структурированных данных', array['analysis', 'fast', 'long_context']::text[]),
    ('Marketer', 'Data Analyst', 'Data Analyst', 'Аналитика, отчёты и KPI', array['analysis', 'reasoning', 'long_context']::text[]),
    ('HR', 'Рекрутинг', 'Рекрутинг', 'Вакансии, поиск и отбор кандидатов', array['writing', 'analysis', 'fast']::text[]),
    ('HR', 'Онбординг', 'Онбординг', 'Адаптация новых сотрудников', array['writing', 'reasoning', 'long_context']::text[]),
    ('HR', 'People Ops', 'People Ops', 'Командные процессы и вовлечённость', array['analysis', 'reasoning', 'long_context']::text[]),
    ('HR', 'COO', 'COO', 'Операционные процессы и координация', array['analysis', 'reasoning', 'long_context']::text[])
) as seed(department_name, name, role, description, capabilities)
left join public.ai_departments department
  on department.organization_id = org.id
 and department.name = seed.department_name
on conflict (organization_id, role) do nothing;

-- Postgres Changes is used only through the publication; the locked realtime
-- schema is intentionally left untouched.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ai_departments',
    'ai_agents',
    'ai_model_configs',
    'ai_tasks',
    'task_events',
    'approval_requests',
    'artifacts'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

comment on table public.ai_tasks is 'Organization-scoped work queue for Orbit AI Workflow.';
comment on table public.ai_model_configs is 'Capability-tagged model routing configuration; never stores provider secrets.';
comment on table public.approval_requests is 'Strategic approvals routed to the CEO agent.';
