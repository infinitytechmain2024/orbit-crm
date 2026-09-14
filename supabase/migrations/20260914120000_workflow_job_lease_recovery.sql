-- Recover workflow jobs whose worker disappeared mid-execution (e.g. Render
-- instance hibernated). A leased job is considered abandoned once
-- locked_at + timeout_seconds + 60s has passed: the extra minute lets a live
-- worker, which aborts at timeout_seconds, record its own retry/failure first.

create index if not exists workflow_jobs_leased_idx
  on public.workflow_jobs (locked_at)
  where status = 'leased';

create or replace function public.claim_workflow_job(p_worker_id text)
returns setof public.workflow_jobs
language sql
security invoker
set search_path = ''
as $$
  with candidate as (
    select job.id, job.status as previous_status, job.locked_by as previous_worker
    from public.workflow_jobs job
    join public.workflow_runs run
      on run.organization_id = job.organization_id
     and run.id = job.workflow_run_id
    where (
        (job.status = 'queued' and job.available_at <= now())
     or (job.status = 'leased'
         and job.attempts < job.max_attempts
         and job.locked_at + make_interval(secs => job.timeout_seconds + 60) < now())
    )
      and run.status not in ('paused', 'cancelled', 'completed', 'failed')
    order by job.available_at, job.created_at
    for update of job skip locked
    limit 1
  ),
  claimed as (
    update public.workflow_jobs job
    set status = 'leased',
        locked_at = now(),
        locked_by = left(p_worker_id, 120),
        attempts = job.attempts + 1,
        last_error = case
          when candidate.previous_status = 'leased' then jsonb_build_object(
            'type', 'LeaseExpired',
            'message', 'Worker потерян, этап восстановлен',
            'previous_worker', candidate.previous_worker
          )
          else job.last_error
        end
    from candidate
    where job.id = candidate.id
    returning job.*
  ),
  orphaned_agent_runs as (
    update public.agent_runs agent_run
    set status = 'failed',
        error = jsonb_build_object('type', 'LeaseExpired', 'message', 'Worker потерян'),
        completed_at = now()
    from claimed
    where claimed.last_error ->> 'type' = 'LeaseExpired'
      and claimed.locked_by = left(p_worker_id, 120)
      and agent_run.organization_id = claimed.organization_id
      and agent_run.workflow_run_id = claimed.workflow_run_id
      and agent_run.task_id = claimed.task_id
      and agent_run.status in ('assigned', 'working')
    returning agent_run.id
  )
  select * from claimed;
$$;

revoke execute on function public.claim_workflow_job(text) from public, anon, authenticated;
grant execute on function public.claim_workflow_job(text) to service_role;

create or replace function public.fail_exhausted_workflow_jobs()
returns setof public.workflow_jobs
language sql
security invoker
set search_path = ''
as $$
  with exhausted as (
    update public.workflow_jobs job
    set status = 'failed',
        completed_at = now(),
        last_error = jsonb_build_object(
          'type', 'LeaseExpired',
          'message', 'Worker потерян, попытки исчерпаны',
          'previous_worker', job.locked_by
        )
    from public.workflow_runs run
    where run.organization_id = job.organization_id
      and run.id = job.workflow_run_id
      and run.status not in ('paused', 'cancelled', 'completed', 'failed')
      and job.status = 'leased'
      and job.attempts >= job.max_attempts
      and job.locked_at + make_interval(secs => job.timeout_seconds + 60) < now()
    returning job.*
  ),
  orphaned_agent_runs as (
    update public.agent_runs agent_run
    set status = 'failed',
        error = jsonb_build_object('type', 'LeaseExpired', 'message', 'Worker потерян'),
        completed_at = now()
    from exhausted
    where agent_run.organization_id = exhausted.organization_id
      and agent_run.workflow_run_id = exhausted.workflow_run_id
      and agent_run.task_id = exhausted.task_id
      and agent_run.status in ('assigned', 'working')
    returning agent_run.id
  )
  select * from exhausted;
$$;

revoke execute on function public.fail_exhausted_workflow_jobs() from public, anon, authenticated;
grant execute on function public.fail_exhausted_workflow_jobs() to service_role;
