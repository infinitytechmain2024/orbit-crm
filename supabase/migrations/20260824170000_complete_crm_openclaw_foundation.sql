-- Orbit CRM production reconciliation: core CRM records, memory, and OpenClaw.
-- Additive only: this migration does not delete or rewrite existing business data.

create extension if not exists pgcrypto;

do $$ begin
  create type public.lead_client_priority as enum ('High', 'Middle', 'Low');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.lead_client_status as enum ('Lead', 'New', 'In Progress', 'Rejected', 'Archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.lead_website_status as enum ('no_website', 'needs_upgrade', 'good');
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create table if not exists public.lead_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  business_name text not null check (char_length(trim(business_name)) between 1 and 240),
  category text not null default '',
  city_location text not null default '',
  country text not null default '',
  country_flag text not null default '',
  contact_phone text,
  email text not null default '',
  website_url text not null default '',
  whatsapp_status text not null default '',
  google_maps_url text,
  priority public.lead_client_priority not null default 'Middle',
  status public.lead_client_status not null default 'Lead',
  website_status_type public.lead_website_status,
  ai_offer_script jsonb,
  source_query text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists lead_clients_org_city_idx on public.lead_clients(organization_id, city_location);
create index if not exists lead_clients_org_status_idx on public.lead_clients(organization_id, status);
drop trigger if exists set_lead_clients_updated_at on public.lead_clients;
create trigger set_lead_clients_updated_at before update on public.lead_clients
for each row execute function public.set_updated_at();

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  project_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 240),
  stage text not null default 'new' check (stage in ('new','qualified','proposal','negotiation','won','lost')),
  value numeric(14,2) not null default 0 check (value >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  expected_close_at timestamptz,
  owner_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deals_client_fk foreign key (organization_id, client_id)
    references public.lead_clients(organization_id, id) on delete set null,
  constraint deals_project_fk foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete set null
);
create index if not exists deals_org_stage_idx on public.deals(organization_id, stage);
drop trigger if exists set_deals_updated_at on public.deals;
create trigger set_deals_updated_at before update on public.deals
for each row execute function public.set_updated_at();

create table if not exists public.client_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  deal_id uuid references public.deals(id) on delete set null,
  interaction_type text not null check (interaction_type in ('note','email','call','meeting','message','status_change')),
  direction text check (direction in ('inbound','outbound','internal')),
  subject text,
  content text not null default '',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint client_interactions_client_fk foreign key (organization_id, client_id)
    references public.lead_clients(organization_id, id) on delete cascade
);
create index if not exists client_interactions_timeline_idx
  on public.client_interactions(organization_id, client_id, occurred_at desc);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  deal_id uuid references public.deals(id) on delete set null,
  task_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 240),
  client_name text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'new' check (status in ('new','pending','confirmed','completed','cancelled')),
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_client_fk foreign key (organization_id, client_id)
    references public.lead_clients(organization_id, id) on delete set null,
  constraint calendar_events_task_fk foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete set null
);
create index if not exists calendar_events_org_time_idx on public.calendar_events(organization_id, starts_at);
create index if not exists calendar_events_reminder_idx on public.calendar_events(reminder_at)
  where reminder_at is not null and reminder_sent_at is null;
drop trigger if exists set_calendar_events_updated_at on public.calendar_events;
create trigger set_calendar_events_updated_at before update on public.calendar_events
for each row execute function public.set_updated_at();

create table if not exists public.ai_user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('project','task','contact','client','company','synonym','preference','outcome')),
  entity_id uuid,
  key_phrase text not null check (char_length(trim(key_phrase)) between 1 and 500),
  memory_value jsonb not null,
  confidence numeric(3,2) not null default 0.80 check (confidence between 0 and 1),
  source text not null default 'user' check (source in ('user','crm','openclaw','import')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, organization_id, entity_type, key_phrase)
);
create index if not exists ai_user_memory_scope_idx on public.ai_user_memory(organization_id, user_id, entity_type);
drop trigger if exists set_ai_user_memory_updated_at on public.ai_user_memory;
create trigger set_ai_user_memory_updated_at before update on public.ai_user_memory
for each row execute function public.set_updated_at();

create table if not exists public.openclaw_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  entity_type text,
  entity_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 240),
  description text not null default '',
  status text not null default 'queued' check (status in ('pending','queued','processing','completed','error','cancelled')),
  result jsonb,
  error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, idempotency_key)
);
create index if not exists openclaw_tasks_org_created_idx on public.openclaw_tasks(organization_id, created_at desc);
drop trigger if exists set_openclaw_tasks_updated_at on public.openclaw_tasks;
create trigger set_openclaw_tasks_updated_at before update on public.openclaw_tasks
for each row execute function public.set_updated_at();

create table if not exists public.openclaw_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  label text not null check (char_length(trim(label)) between 1 and 240),
  description text not null default '',
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  status text not null default 'active' check (status in ('active','paused','completed','error','cancelled')),
  progress jsonb not null default '{"done":0,"total":0}'::jsonb,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists openclaw_goals_org_status_idx on public.openclaw_goals(organization_id, status);
drop trigger if exists set_openclaw_goals_updated_at on public.openclaw_goals;
create trigger set_openclaw_goals_updated_at before update on public.openclaw_goals
for each row execute function public.set_updated_at();

create table if not exists public.openclaw_improvements (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.openclaw_goals(id) on delete cascade,
  suggestion text not null,
  impact text,
  file_path text,
  code_before text,
  code_after text,
  status text not null default 'pending_review' check (status in ('pending_review','approved','applied','rejected','rolled_back')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  rollback_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists openclaw_improvements_goal_status_idx on public.openclaw_improvements(goal_id, status);

create table if not exists public.openclaw_analyses (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.openclaw_goals(id) on delete cascade,
  analysis_type text,
  content text,
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_action_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  status text not null check (status in ('proposed','approved','rejected','executed','failed','rolled_back')),
  input_summary jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_action_audit_org_created_idx on public.ai_action_audit(organization_id, created_at desc);

create or replace function public.get_lead_clients_by_city(p_user_id uuid, p_status text default null)
returns table(city_location text, clients jsonb, client_count bigint)
language sql stable security invoker set search_path = '' as $$
  select lc.city_location,
    jsonb_agg(to_jsonb(lc) order by lc.priority, lc.business_name) as clients,
    count(*) as client_count
  from public.lead_clients lc
  where lc.user_id = p_user_id
    and (p_status is null or lc.status::text = p_status)
  group by lc.city_location
  order by lc.city_location;
$$;

alter table public.lead_clients enable row level security;
alter table public.deals enable row level security;
alter table public.client_interactions enable row level security;
alter table public.calendar_events enable row level security;
alter table public.ai_user_memory enable row level security;
alter table public.openclaw_tasks enable row level security;
alter table public.openclaw_goals enable row level security;
alter table public.openclaw_improvements enable row level security;
alter table public.openclaw_analyses enable row level security;
alter table public.ai_action_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lead_clients','deals','client_interactions','calendar_events','openclaw_tasks','openclaw_goals'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_organization_member(organization_id, (select auth.uid())))', t || '_member_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_organization_member(organization_id, (select auth.uid())))', t || '_member_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_organization_member(organization_id, (select auth.uid()))) with check (private.is_organization_member(organization_id, (select auth.uid())))', t || '_member_update', t);
  end loop;
exception when duplicate_object then null;
end $$;

create policy ai_user_memory_owner_all on public.ai_user_memory for all to authenticated
using (user_id = (select auth.uid()) and private.is_organization_member(organization_id, (select auth.uid())))
with check (user_id = (select auth.uid()) and private.is_organization_member(organization_id, (select auth.uid())));
create policy openclaw_improvements_member_select on public.openclaw_improvements for select to authenticated
using (exists(select 1 from public.openclaw_goals g where g.id = goal_id and private.is_organization_member(g.organization_id, (select auth.uid()))));
create policy openclaw_analyses_member_select on public.openclaw_analyses for select to authenticated
using (exists(select 1 from public.openclaw_goals g where g.id = goal_id and private.is_organization_member(g.organization_id, (select auth.uid()))));
create policy ai_action_audit_member_select on public.ai_action_audit for select to authenticated
using (private.is_organization_member(organization_id, (select auth.uid())));

revoke all on public.lead_clients, public.deals, public.client_interactions, public.calendar_events,
  public.ai_user_memory, public.openclaw_tasks, public.openclaw_goals, public.openclaw_improvements,
  public.openclaw_analyses, public.ai_action_audit from anon;
grant select, insert, update on public.lead_clients, public.deals, public.client_interactions,
  public.calendar_events, public.ai_user_memory, public.openclaw_tasks, public.openclaw_goals to authenticated;
grant select on public.openclaw_improvements, public.openclaw_analyses, public.ai_action_audit to authenticated;
grant execute on function public.get_lead_clients_by_city(uuid, text) to authenticated;
grant all on public.lead_clients, public.deals, public.client_interactions, public.calendar_events,
  public.ai_user_memory, public.openclaw_tasks, public.openclaw_goals, public.openclaw_improvements,
  public.openclaw_analyses, public.ai_action_audit to service_role;
