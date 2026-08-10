-- AI User Memory Table for AI Self-Learning & Memory System
-- Created: 2026-08-10
-- Description: Stores AI user memory for self-learning and context memory system

create extension if not exists "pgcrypto";

create table if not exists public.ai_user_memory (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('project', 'task', 'contact', 'synonym', 'preference')),
  key_phrase text not null,
  memory_value jsonb not null,
  confidence numeric(3,2) not null default 0.8 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, organization_id, entity_type, key_phrase)
);

create index if not exists ai_user_memory_user_org_idx
  on public.ai_user_memory (user_id, organization_id);

create index if not exists ai_user_memory_search_idx
  on public.ai_user_memory (user_id, organization_id, entity_type, key_phrase);

create function update_ai_user_memory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;

create trigger ai_user_memory_updated_at
  before update on public.ai_user_memory
  for each row
  execute function update_ai_user_memory_updated_at();

comment on table public.ai_user_memory is
'Stores AI user memory for self-learning and context memory system. Stores user corrections, project mappings, synonyms, and preferences.';

comment on column public.ai_user_memory.entity_type is
'Type of entity: project, task, contact, synonym, preference';
comment on column public.ai_user_memory.key_phrase is
'User phrase/phrase that triggers memory (lowercase, trimmed)';
comment on column public.ai_user_memory.memory_value is
'JSON value: {project_id, project_name}, {task_title}, {company_name}, {synonym}, {preference_key}';
comment on column public.ai_user_memory.confidence
'Confidence score 0-1, higher = more confident';