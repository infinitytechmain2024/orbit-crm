alter table public.ai_action_audit
  add column if not exists correlation_id uuid not null default gen_random_uuid();

create index if not exists ai_action_audit_correlation_idx
  on public.ai_action_audit(organization_id, correlation_id, created_at desc);

comment on column public.ai_action_audit.correlation_id is
  'Request correlation identifier for tracing an AI action across Vercel, backend, OpenClaw and Supabase.';
;
