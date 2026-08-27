-- Fix: add 'idle' to ai_agents.status check constraint
-- The backend code uses status='idle' in ensure_bootstrap() and ai_workflow_router.py
-- but the original constraint only allowed active|paused|retired.

ALTER TABLE "public"."ai_agents" DROP CONSTRAINT IF EXISTS "ai_agents_status_check";

ALTER TABLE "public"."ai_agents" ADD CONSTRAINT "ai_agents_status_check"
  CHECK (status = ANY (ARRAY['active'::text, 'idle'::text, 'paused'::text, 'retired'::text]));
