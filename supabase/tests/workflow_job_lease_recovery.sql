-- Self-rolling-back test for claim_workflow_job / fail_exhausted_workflow_jobs.
-- Run the migration body and this block in ONE request; the block always ends
-- with an exception so nothing is persisted. Success message:
--   LEASE_RECOVERY_TESTS_PASSED
-- Uses the production organization's existing user and agent as FK fixtures.
do $$
declare
  v_org uuid := 'f009bee0-c0d0-47eb-a5d0-4e291a43a700';
  v_user uuid;
  v_agent uuid;
  v_task_stale uuid := gen_random_uuid();
  v_task_queued uuid := gen_random_uuid();
  v_task_other uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
  v_run_paused uuid := gen_random_uuid();
  v_job_stale uuid := gen_random_uuid();
  v_job_queued uuid := gen_random_uuid();
  v_job_fresh uuid := gen_random_uuid();
  v_job_boundary uuid := gen_random_uuid();
  v_job_exhausted uuid := gen_random_uuid();
  v_job_paused uuid := gen_random_uuid();
  v_agent_run uuid := gen_random_uuid();
  v_agent_run_exhausted uuid := gen_random_uuid();
  v_claimed public.workflow_jobs;
  v_count integer;
begin
  select created_by into strict v_user
    from public.ai_tasks where organization_id = v_org limit 1;
  select id into strict v_agent
    from public.ai_agents where organization_id = v_org limit 1;

  -- Isolate from real queue rows (rolled back at the end).
  update public.workflow_jobs set status = 'cancelled'
   where status in ('queued', 'leased');

  insert into public.ai_tasks (id, organization_id, title, created_by, status) values
    (v_task_stale, v_org, 'lease-test stale', v_user, 'in_progress'),
    (v_task_queued, v_org, 'lease-test queued', v_user, 'queued'),
    (v_task_other, v_org, 'lease-test other', v_user, 'in_progress');

  insert into public.workflow_runs (id, organization_id, root_task_id, created_by, status) values
    (v_run, v_org, v_task_stale, v_user, 'running'),
    (v_run_paused, v_org, v_task_other, v_user, 'paused');

  insert into public.workflow_jobs
    (id, organization_id, workflow_run_id, task_id, job_type, idempotency_key,
     status, attempts, max_attempts, timeout_seconds, available_at, locked_at, locked_by)
  values
    (v_job_stale, v_org, v_run, v_task_stale, 'execute', 'lease-test-stale',
     'leased', 1, 3, 60, now() - interval '30 minutes', now() - interval '10 minutes', 'dead-worker'),
    (v_job_queued, v_org, v_run, v_task_queued, 'execute', 'lease-test-queued',
     'queued', 0, 3, 60, now() - interval '1 minute', null, null),
    (v_job_fresh, v_org, v_run, v_task_other, 'qa', 'lease-test-fresh',
     'leased', 1, 3, 60, now() - interval '40 minutes', now(), 'live-worker'),
    -- 150s ago with timeout 60: inside the 120s grace (60 + 120 = 180s), must not be reclaimed.
    (v_job_boundary, v_org, v_run, v_task_other, 'finalize', 'lease-test-boundary',
     'leased', 1, 3, 60, now() - interval '45 minutes', now() - interval '150 seconds', 'slow-worker'),
    (v_job_exhausted, v_org, v_run, v_task_other, 'execute', 'lease-test-exhausted',
     'leased', 3, 3, 60, now() - interval '50 minutes', now() - interval '10 minutes', 'dead-worker'),
    (v_job_paused, v_org, v_run_paused, v_task_other, 'plan', 'lease-test-paused',
     'leased', 1, 3, 60, now() - interval '60 minutes', now() - interval '10 minutes', 'dead-worker');

  insert into public.agent_runs (id, organization_id, workflow_run_id, task_id, agent_id, status) values
    (v_agent_run, v_org, v_run, v_task_stale, v_agent, 'working'),
    (v_agent_run_exhausted, v_org, v_run, v_task_other, v_agent, 'working');

  -- 1. Stale leased job is reclaimed first (earliest available_at among eligible).
  select * into v_claimed from public.claim_workflow_job('test-worker');
  assert v_claimed.id = v_job_stale, format('expected stale job, got %s', v_claimed.id);
  assert v_claimed.status = 'leased', 'stale job must be leased again';
  assert v_claimed.attempts = 2, format('attempts must be 2, got %s', v_claimed.attempts);
  assert v_claimed.locked_by = 'test-worker', 'locked_by must be the new worker';
  assert v_claimed.last_error ->> 'type' = 'LeaseExpired', 'last_error.type must be LeaseExpired';
  assert v_claimed.last_error ->> 'previous_worker' = 'dead-worker', 'previous_worker must be kept';
  assert (v_claimed.last_error ->> 'attempt')::int = 2, 'last_error.attempt must match the new attempt';
  assert (select status from public.agent_runs where id = v_agent_run) = 'failed',
    'orphaned agent_run must be failed';
  assert (select status from public.agent_runs where id = v_agent_run_exhausted) = 'working',
    'agent_run of another task must be untouched by the claim';

  -- 2. Queued job still works and keeps last_error untouched.
  select * into v_claimed from public.claim_workflow_job('test-worker');
  assert v_claimed.id = v_job_queued, format('expected queued job, got %s', v_claimed.id);
  assert v_claimed.last_error is null, 'queued claim must not set last_error';

  -- 3. Nothing else is claimable: fresh lease, grace boundary, exhausted, paused run.
  select count(*) into v_count from public.claim_workflow_job('test-worker');
  assert v_count = 0, format('expected no more claimable jobs, got %s', v_count);
  assert (select status from public.workflow_jobs where id = v_job_boundary) = 'leased',
    'job inside the grace period must stay leased';

  -- 4. Exhausted stale job is failed and blocks task, run and root; others untouched.
  select count(*) into v_count from public.fail_exhausted_workflow_jobs() where id = v_job_exhausted;
  assert v_count = 1, 'exhausted job must be returned';
  assert (select status from public.workflow_jobs where id = v_job_exhausted) = 'failed',
    'exhausted job must be failed';
  assert (select completed_at from public.workflow_jobs where id = v_job_exhausted) is not null,
    'exhausted job must have completed_at';
  assert (select status from public.agent_runs where id = v_agent_run_exhausted) = 'failed',
    'agent_run of the exhausted job must be failed';
  assert (select status from public.ai_tasks where id = v_task_other) = 'blocked',
    'task of the exhausted job must be blocked';
  assert (select status from public.workflow_runs where id = v_run) = 'blocked',
    'run of the exhausted job must be blocked';
  assert (select current_phase from public.workflow_runs where id = v_run) = 'blocked',
    'run phase must be blocked';
  assert (select status from public.ai_tasks where id = v_task_stale) = 'blocked',
    'root task of the run must be blocked';
  assert (select blocker_reason from public.ai_tasks where id = v_task_other) = 'Worker потерян, попытки исчерпаны',
    'exhausted task must carry blocker_reason';
  assert (select blocker_reason from public.ai_tasks where id = v_task_stale)
    = 'Workflow заблокирован: worker потерян, попытки исчерпаны',
    'root task must carry workflow blocker_reason';
  assert (select status from public.workflow_jobs where id = v_job_paused) = 'leased',
    'paused-run job must stay leased';
  assert (select status from public.workflow_runs where id = v_run_paused) = 'paused',
    'paused run must stay paused';
  assert (select status from public.workflow_jobs where id = v_job_fresh) = 'leased',
    'fresh job must stay leased';
  select count(*) into v_count from public.fail_exhausted_workflow_jobs();
  assert v_count = 0, 'second sweep must return nothing';

  -- 5. Privileges.
  assert not has_function_privilege('anon', 'public.claim_workflow_job(text)', 'execute'),
    'anon must not execute claim_workflow_job';
  assert not has_function_privilege('authenticated', 'public.claim_workflow_job(text)', 'execute'),
    'authenticated must not execute claim_workflow_job';
  assert not has_function_privilege('anon', 'public.fail_exhausted_workflow_jobs()', 'execute'),
    'anon must not execute fail_exhausted_workflow_jobs';
  assert not has_function_privilege('authenticated', 'public.fail_exhausted_workflow_jobs()', 'execute'),
    'authenticated must not execute fail_exhausted_workflow_jobs';
  assert has_function_privilege('service_role', 'public.fail_exhausted_workflow_jobs()', 'execute'),
    'service_role must execute fail_exhausted_workflow_jobs';

  raise exception 'LEASE_RECOVERY_TESTS_PASSED';
end
$$;
