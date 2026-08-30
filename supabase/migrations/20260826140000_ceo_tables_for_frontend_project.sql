-- Migration: CEO tables + tasks columns for the frontend Supabase project (qavfajsflzbefgegkwjt)
-- Apply this via Supabase Dashboard → SQL Editor for the qavfajsflzbefgegkwjt project

-- 1. activity_log (simple activity feed)
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

DO $$ BEGIN
    create policy "activity_log_select_auth" on public.activity_log
      for select to authenticated using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    create policy "activity_log_insert_auth" on public.activity_log
      for insert to authenticated with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. ceo_approval_requests
create table if not exists public.ceo_approval_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  requested_by_agent text not null default 'ai-ceo',
  assigned_to_user uuid,
  status text not null default 'pending',
  action text not null,
  reason text,
  risk_level text,
  change_summary jsonb,
  decision_comment text,
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ceo_approval_requests enable row level security;

DO $$ BEGIN
    create policy "ceo_approval_requests_select_auth" on public.ceo_approval_requests
      for select to authenticated using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    create policy "ceo_approval_requests_insert_auth" on public.ceo_approval_requests
      for insert to authenticated with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    create policy "ceo_approval_requests_update_auth" on public.ceo_approval_requests
      for update to authenticated using (true) with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. deployment_queue
create table if not exists public.deployment_queue (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  project_id uuid,
  deployment_type text not null,
  status text not null default 'pending',
  deployment_config jsonb not null default '{}'::jsonb,
  approval_required boolean default true,
  approved_by uuid,
  approved_at timestamptz,
  deployed_at timestamptz,
  deployment_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deployment_queue enable row level security;

DO $$ BEGIN
    create policy "deployment_queue_select_auth" on public.deployment_queue
      for select to authenticated using (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    create policy "deployment_queue_insert_auth" on public.deployment_queue
      for insert to authenticated with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    create policy "deployment_queue_update_auth" on public.deployment_queue
      for update to authenticated using (true) with check (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. CEO columns on tasks table
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'action_type' and table_schema = 'public'
  ) then
    alter table public.tasks add column action_type text default 'change';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'approval_status' and table_schema = 'public'
  ) then
    alter table public.tasks add column approval_status text default 'draft';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'approval_requested_at' and table_schema = 'public'
  ) then
    alter table public.tasks add column approval_requested_at timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'approval_decided_at' and table_schema = 'public'
  ) then
    alter table public.tasks add column approval_decided_at timestamptz;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'approval_decided_by' and table_schema = 'public'
  ) then
    alter table public.tasks add column approval_decided_by uuid;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'deployment_status' and table_schema = 'public'
  ) then
    alter table public.tasks add column deployment_status text default 'not_deployed';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'deployment_url' and table_schema = 'public'
  ) then
    alter table public.tasks add column deployment_url text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'risk_assessment' and table_schema = 'public'
  ) then
    alter table public.tasks add column risk_assessment jsonb;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'change_package' and table_schema = 'public'
  ) then
    alter table public.tasks add column change_package jsonb;
  end if;
end $$;
