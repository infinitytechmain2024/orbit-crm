-- Fix: ai_tasks.source check rejected "ai_brain_dump" from BrainDump dispatch
-- The restore_orbit_commander migration defined ai_tasks_source_check as
-- ('text','voice','manual','project','note','client','api') but both the
-- backend API (backend/routers/ai_workflow.py:52) and the BrainDump UI
-- (src/routes/index.tsx, src/features/ai-workflow/types.ts) legitimately
-- send source='ai_brain_dump'. The BrainDump dispatch RPC
-- dispatch_brain_dump_to_workflow also inserts ai_brain_dump. Without the
-- fix every /api/ai-workflow/tasks call from BrainDump 502s with
-- "violates check constraint ai_tasks_source_check".

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='ai_tasks'
  ) then
    -- Drop the old check if it exists (name varies between environments;
    -- the canonical name is ai_tasks_source_check).
    if exists (
      select 1 from pg_constraint
      where conname='ai_tasks_source_check'
        and conrelid='public.ai_tasks'::regclass
    ) then
      alter table public.ai_tasks drop constraint ai_tasks_source_check;
    end if;

    -- Add the corrected check that includes ai_brain_dump. Use a guard
    -- so a re-run doesn't fail if the constraint was already fixed.
    if not exists (
      select 1 from pg_constraint
      where conname='ai_tasks_source_check'
        and conrelid='public.ai_tasks'::regclass
    ) then
      alter table public.ai_tasks
        add constraint ai_tasks_source_check
        check (source in ('text','voice','manual','project','note','client','api','ai_brain_dump'));
    end if;
  end if;
end $$;

comment on constraint ai_tasks_source_check on public.ai_tasks is 'Allowed task origins including ai_brain_dump for BrainDump → Orbit Commander dispatch';
