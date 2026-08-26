-- Versioned company knowledge and human-approved learning proposals.

create table if not exists public.company_knowledge (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9_-]{1,119}$'),
  title text not null check (char_length(trim(title)) between 1 and 240),
  category text not null default 'general',
  current_version integer not null default 0 check (current_version >= 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, slug),
  unique(organization_id, id)
);

create table if not exists public.company_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  knowledge_id uuid not null,
  version integer not null check (version > 0),
  content jsonb not null,
  change_summary text not null,
  source text not null check (source in ('human','approved_ai_proposal','rollback','import')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint company_knowledge_versions_parent_fk foreign key (organization_id, knowledge_id)
    references public.company_knowledge(organization_id, id) on delete cascade,
  unique(knowledge_id, version)
);

create table if not exists public.ai_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  interaction_id uuid references public.client_interactions(id) on delete set null,
  action_type text not null,
  recommendation text,
  outcome text not null check (outcome in ('successful','unsuccessful','neutral','unknown')),
  score numeric(5,2),
  evidence jsonb not null default '{}'::jsonb,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint ai_outcomes_client_fk foreign key (organization_id, client_id)
    references public.lead_clients(organization_id, id) on delete set null
);

create table if not exists public.ai_improvement_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null check (target_type in ('knowledge','template','business_process')),
  knowledge_id uuid references public.company_knowledge(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  rationale text not null,
  evidence jsonb not null default '[]'::jsonb,
  proposed_content jsonb not null,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  confidence numeric(3,2) check (confidence between 0 and 1),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','applied','rolled_back')),
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  applied_version integer,
  rollback_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_knowledge_org_category_idx on public.company_knowledge(organization_id, category);
create index if not exists company_knowledge_versions_parent_idx on public.company_knowledge_versions(organization_id, knowledge_id, version desc);
create index if not exists ai_outcomes_org_client_idx on public.ai_outcomes(organization_id, client_id, created_at desc);
create index if not exists ai_outcomes_recorded_by_idx on public.ai_outcomes(recorded_by);
create index if not exists ai_improvement_proposals_org_status_idx on public.ai_improvement_proposals(organization_id, status, created_at desc);
create index if not exists ai_improvement_proposals_created_by_idx on public.ai_improvement_proposals(created_by);
create index if not exists ai_improvement_proposals_reviewed_by_idx on public.ai_improvement_proposals(reviewed_by);

alter table public.company_knowledge enable row level security;
alter table public.company_knowledge_versions enable row level security;
alter table public.ai_outcomes enable row level security;
alter table public.ai_improvement_proposals enable row level security;

create policy company_knowledge_member_select on public.company_knowledge for select to authenticated
using (private.is_organization_member(organization_id, (select auth.uid())));
create policy company_knowledge_versions_member_select on public.company_knowledge_versions for select to authenticated
using (private.is_organization_member(organization_id, (select auth.uid())));
create policy ai_outcomes_member_select on public.ai_outcomes for select to authenticated
using (private.is_organization_member(organization_id, (select auth.uid())));
create policy ai_improvement_proposals_member_select on public.ai_improvement_proposals for select to authenticated
using (private.is_organization_member(organization_id, (select auth.uid())));

revoke all on public.company_knowledge, public.company_knowledge_versions, public.ai_outcomes,
  public.ai_improvement_proposals from anon, authenticated;
grant select on public.company_knowledge, public.company_knowledge_versions, public.ai_outcomes,
  public.ai_improvement_proposals to authenticated;
grant all on public.company_knowledge, public.company_knowledge_versions, public.ai_outcomes,
  public.ai_improvement_proposals to service_role;
