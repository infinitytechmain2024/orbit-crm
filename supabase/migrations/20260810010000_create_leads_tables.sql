-- Leads & Lead Search Jobs tables
-- Created: 2026-08-10
-- Description: Stores scraped leads and search job tracking

-- ============================
-- ENUMS
-- ============================

do $$
begin
  create type public.lead_status as enum (
    'new',
    'processed',
    'rejected'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.lead_search_status as enum (
    'queued',
    'running',
    'completed',
    'failed'
  );
exception
  when duplicate_object then null;
end $$;

-- ============================
-- LEADS TABLE
-- ============================

create table if not exists public.leads (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  company_name text not null default '',
  website text,
  contacts jsonb not null default '{}'::jsonb,
  source_query text not null default '',
  status public.lead_status not null default 'new',
  responsible_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.leads is 'Stores scraped leads from OpenManus browser agent, linked to projects';
comment on column public.leads.contacts is 'JSONB: {email, phone, social_links: {telegram, whatsapp, linkedin}}';
comment on column public.leads.source_query is 'The search query or voice command that produced this lead';
comment on column public.leads.status is 'Lead lifecycle: new -> processed -> rejected';

-- Indexes
create index if not exists leads_org_idx on public.leads (organization_id);
create index if not exists leads_project_idx on public.leads (project_id) where project_id is not null;
create index if not exists leads_status_idx on public.leads (organization_id, status);
create index if not exists leads_responsible_idx on public.leads (responsible_user_id) where responsible_user_id is not null;
create index if not exists leads_company_idx on public.leads using gin (to_tsvector('simple', company_name));

-- Updated_at trigger
create or replace function update_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;

$$;

create trigger leads_updated_at
  before update on public.leads
  for each row
  execute function update_leads_updated_at();

-- ============================
-- LEAD SEARCH JOBS TABLE
-- ============================

create table if not exists public.lead_search_jobs (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  city text,
  niche text,
  max_results integer not null default 20 check (max_results > 0 and max_results <= 500),
  status public.lead_search_status not null default 'queued',
  raw_request text,
  leads_found integer not null default 0,
  report_path text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.lead_search_jobs is 'Tracks OpenManus lead search jobs triggered by voice commands or manual search';
comment on column public.lead_search_jobs.city is 'Target city for lead search (e.g. "Dubai, UAE")';
comment on column public.lead_search_jobs.niche is 'Target industry/niche (e.g. "Real Estate Agencies")';

-- Indexes
create index if not exists lead_search_jobs_org_idx on public.lead_search_jobs (organization_id);
create index if not exists lead_search_jobs_user_idx on public.lead_search_jobs (user_id);
create index if not exists lead_search_jobs_status_idx on public.lead_search_jobs (organization_id, status);

-- ============================
-- ROW LEVEL SECURITY
-- ============================

alter table public.leads enable row level security;
alter table public.lead_search_jobs enable row level security;

-- Leads: org members can read, owners/admins can write
create policy "leads_select_org_members" on public.leads
  for select
  using (private.is_organization_member(organization_id));

create policy "leads_insert_org_members" on public.leads
  for insert
  with check (private.is_organization_member(organization_id));

create policy "leads_update_org_members" on public.leads
  for update
  using (private.is_organization_member(organization_id));

create policy "leads_delete_org_owners" on public.leads
  for delete
  using (
    private.is_organization_member(organization_id)
    and private.has_org_role(organization_id, 'owner')
  );

-- Lead search jobs: org members can read, authenticated users can insert their own
create policy "lead_search_jobs_select_org_members" on public.lead_search_jobs
  for select
  using (private.is_organization_member(organization_id));

create policy "lead_search_jobs_insert_authenticated" on public.lead_search_jobs
  for insert
  with check (
    auth.uid() = user_id
    and private.is_organization_member(organization_id)
  );

create policy "lead_search_jobs_update_own" on public.lead_search_jobs
  for update
  using (auth.uid() = user_id);

-- ============================
-- BACKFILL: Add organization_id to existing leads (if any rows exist)
-- ============================

do $$
begin
  -- For any leads that might have been inserted without organization_id,
  -- try to infer from the project
  update public.leads l
  set organization_id = p.organization_id
  from public.projects p
  where l.project_id = p.id
    and l.organization_id is null;
exception
  when others then null;
end $$;
