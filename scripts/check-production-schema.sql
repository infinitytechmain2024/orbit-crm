-- Read-only production readiness gate. Any exception blocks a release.
do $$
declare
  relation_name text;
  required_relations text[] := array[
    'public.organizations',
    'public.organization_members',
    'public.projects',
    'public.tasks',
    'public.deals',
    'public.calendar_events',
    'public.openclaw_tasks',
    'public.ai_tasks',
    'public.workflow_runs',
    'public.workflow_jobs'
  ];
begin
  foreach relation_name in array required_relations loop
    if to_regclass(relation_name) is null then
      raise exception 'Production readiness blocked: missing relation %', relation_name;
    end if;
  end loop;

  if not exists (
    select 1 from storage.buckets where id = 'task-files' and public = false
  ) then
    raise exception 'Production readiness blocked: private task-files bucket is missing';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'orbit-calendar-reminders' and active
  ) then
    raise exception 'Production readiness blocked: calendar reminder cron is inactive';
  end if;
end $$;
