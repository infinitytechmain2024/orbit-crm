# AI Workflow Lease Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зависшие `workflow_jobs` (worker пропал посреди выполнения) автоматически возвращаются в работу, а при исчерпании попыток задача блокируется. Конвейер AI Workflow снова доходит до `done` локально и на production.

**Architecture:** Recovery живёт в SQL. `claim_workflow_job` дополнительно забирает `leased` job'ы с просроченным lease (`locked_at + timeout_seconds + 60s`). Новая `fail_exhausted_workflow_jobs` переводит исчерпанные просроченные job'ы в `failed`. Python-worker раз в интервал вызывает эту функцию и блокирует задачи существующей логикой, а для пере-захваченных job'ов пишет событие `recovered`.

**Tech Stack:** Supabase Postgres (PL/pgSQL / SQL functions, MCP `execute_sql` / `apply_migration`), FastAPI backend на Python 3.12 (`unittest`, `AsyncMock`), TanStack Start frontend (не меняется), Render, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-14-workflow-lease-recovery-design.md`

**Branch:** `fix/workflow-lease-recovery` (уже создана, spec закоммичен).

---

## Факты о проекте, нужные исполнителю

- Supabase project ref: `qavfajsflzbefgegkwjt`. Организация с данными: `f009bee0-c0d0-47eb-a5d0-4e291a43a700`.
- Check-constraint'ы статусов:
  - `workflow_jobs.status`: `queued, leased, succeeded, failed, cancelled`
  - `ai_tasks.status`: `planning, queued, in_progress, paused, review, approval_required, done, blocked, revisions_requested, cancelled`
  - `workflow_runs.status`: `planning, queued, running, paused, review, awaiting_approval, completed, blocked, cancelled, failed`
  - `agent_runs.status`: `assigned, working, blocked, review, completed, failed, cancelled`
- Обязательные колонки без default:
  - `ai_tasks`: `organization_id, title, created_by`
  - `workflow_runs`: `organization_id, root_task_id, created_by`
  - `workflow_jobs`: `organization_id, workflow_run_id, task_id, job_type, idempotency_key`
  - `agent_runs`: `organization_id, workflow_run_id, task_id, agent_id`
- На всех четырёх таблицах есть триггер `set_*_updated_at`, поэтому `updated_at` вручную можно не ставить.
- Текущая `claim_workflow_job` определена в `supabase/migrations/20260826135140_restore_orbit_commander.sql:410-438`.
- Store API (`backend/services/ai_workflow_store.py`): `rpc(name, payload)`, `one(table, *, organization_id, row_id)`, `update(table, *, organization_id, filters, payload)`.
- `commander.create_event(task, event_type, message, *, agent_id=None, metadata=None)`. `event_type` — любая строка 1..80 символов.
- CI запускает `python -m unittest discover -s backend/tests -v` на Python 3.12. Системный `python3` здесь 3.9, поэтому используем `uv`, который есть в `~/.local/bin/uv`.
- Backend читает env из `<repo>/.env` и `backend/.env`. `.env*` в `.gitignore`.
- В репозитории подключён Lovable (`AGENTS.md`): **никаких force-push и amend запушенных коммитов**.
- `.claude/launch.json` указывает на старый путь `/Users/dmytrolishchyna/Desktop/ORBIT CRM/.venv/bin/uvicorn`, его нужно исправить.

## Контрольные точки с пользователем (обязательные «стоп»)

Агент **останавливается и ждёт явного «да»** перед:
1. Task 3, Step 2: выполнение SQL-теста на production-базе (с гарантированным откатом).
2. Task 5: `apply_migration` на production.
3. Task 6: отмена застрявших задач (update данных на production).
4. Task 8: создание `.env`. Секреты вписывает пользователь, агент их не вводит.
5. Task 11: merge в `main` и `git push`.

## File Structure

| Файл | Действие | Ответственность |
|---|---|---|
| `supabase/migrations/20260914120000_workflow_job_lease_recovery.sql` | Create | Новые `claim_workflow_job` и `fail_exhausted_workflow_jobs`, частичный индекс |
| `supabase/tests/workflow_job_lease_recovery.sql` | Create | Самооткатывающийся SQL-тест обеих функций |
| `backend/config.py` | Modify (после `AI_WORKFLOW_POLL_INTERVAL_SECONDS`, ~стр. 58) | Настройка `AI_WORKFLOW_SWEEP_INTERVAL_SECONDS` |
| `backend/services/workflow_worker.py` | Modify | `_block_exhausted`, `_maybe_sweep`, событие `recovered` |
| `backend/tests/test_workflow_worker.py` | Create | Unit-тесты worker'а |
| `.claude/launch.json` | Modify | Правильный путь к uvicorn |
| `.env.example` | Modify | Документировать `AI_WORKFLOW_SWEEP_INTERVAL_SECONDS` |
| `README.md` | Modify (раздел AI Workflow) | Абзац о lease recovery |
| `TASKS.md` | Modify (раздел P0) | Отметить выполненное |

---

### Task 0: Окружение Python и базовая проверка тестов

**Files:** нет изменений (`.venv/` в `.gitignore`)

- [ ] **Step 1: Создать venv на Python 3.12 и установить зависимости backend**

```bash
cd "/Users/dmytrolishchyna/Desktop/Infinity Technology/orbit-crm"
~/.local/bin/uv venv .venv --python 3.12
~/.local/bin/uv pip install --python .venv/bin/python -r backend/requirements.txt
```
Expected: `Installed N packages` без ошибок.

- [ ] **Step 2: Прогнать существующие тесты и зафиксировать базовую линию**

```bash
.venv/bin/python -m unittest discover -s backend/tests 2>&1 | tail -5
```
Expected: `OK` (или `OK (skipped=…)`). Если есть падения, **записать их список в отчёт**: это базовая линия, не наша регрессия. Дальше сравниваем с ней.

---

### Task 1: SQL-миграция

**Files:**
- Create: `supabase/migrations/20260914120000_workflow_job_lease_recovery.sql`

- [ ] **Step 1: Создать файл миграции**

```sql
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
```

Замечание: условие `claimed.last_error ->> 'type' = 'LeaseExpired'` выполняется только при пере-захвате из `leased`. Для job'а из `queued` `last_error` остаётся прежним: это либо `null`, либо ошибка обычного retry с другим `type`.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260914120000_workflow_job_lease_recovery.sql
git commit -m "Add lease recovery to workflow job claiming

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: SQL-тест

**Files:**
- Create: `supabase/tests/workflow_job_lease_recovery.sql`

Тест — один `DO`-блок. Он **всегда заканчивается исключением**: `LEASE_RECOVERY_TESTS_PASSED` при успехе или `ASSERT` failure при провале. Поэтому транзакция откатывается в любом случае, даже если его выполнить на production. Реальные активные job'ы внутри транзакции временно переводятся в `cancelled` (изоляция от глобального `claim`), и этот апдейт тоже откатывается.

- [ ] **Step 1: Создать файл теста**

```sql
-- Self-rolling-back test for claim_workflow_job / fail_exhausted_workflow_jobs.
-- Run the migration body and this block in ONE request; the block always ends
-- with an exception so nothing is persisted. Success message:
--   LEASE_RECOVERY_TESTS_PASSED
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
  v_job_exhausted uuid := gen_random_uuid();
  v_job_paused uuid := gen_random_uuid();
  v_agent_run uuid := gen_random_uuid();
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
    (v_job_exhausted, v_org, v_run, v_task_other, 'execute', 'lease-test-exhausted',
     'leased', 3, 3, 60, now() - interval '50 minutes', now() - interval '10 minutes', 'dead-worker'),
    (v_job_paused, v_org, v_run_paused, v_task_other, 'plan', 'lease-test-paused',
     'leased', 1, 3, 60, now() - interval '60 minutes', now() - interval '10 minutes', 'dead-worker');

  insert into public.agent_runs (id, organization_id, workflow_run_id, task_id, agent_id, status)
  values (v_agent_run, v_org, v_run, v_task_stale, v_agent, 'working');

  -- 1. Stale leased job is reclaimed first (earliest available_at among eligible).
  select * into v_claimed from public.claim_workflow_job('test-worker');
  assert v_claimed.id = v_job_stale, format('expected stale job, got %s', v_claimed.id);
  assert v_claimed.status = 'leased', 'stale job must be leased again';
  assert v_claimed.attempts = 2, format('attempts must be 2, got %s', v_claimed.attempts);
  assert v_claimed.locked_by = 'test-worker', 'locked_by must be the new worker';
  assert v_claimed.last_error ->> 'type' = 'LeaseExpired', 'last_error.type must be LeaseExpired';
  assert v_claimed.last_error ->> 'previous_worker' = 'dead-worker', 'previous_worker must be kept';
  assert (select status from public.agent_runs where id = v_agent_run) = 'failed',
    'orphaned agent_run must be failed';

  -- 2. Queued job still works and keeps last_error untouched.
  select * into v_claimed from public.claim_workflow_job('test-worker');
  assert v_claimed.id = v_job_queued, format('expected queued job, got %s', v_claimed.id);
  assert v_claimed.last_error is null, 'queued claim must not set last_error';

  -- 3. Nothing else is claimable: fresh lease, exhausted, paused run.
  select count(*) into v_count from public.claim_workflow_job('test-worker');
  assert v_count = 0, format('expected no more claimable jobs, got %s', v_count);

  -- 4. Exhausted stale job is failed; paused-run job is untouched.
  select count(*) into v_count from public.fail_exhausted_workflow_jobs() where id = v_job_exhausted;
  assert v_count = 1, 'exhausted job must be returned';
  assert (select status from public.workflow_jobs where id = v_job_exhausted) = 'failed',
    'exhausted job must be failed';
  assert (select completed_at from public.workflow_jobs where id = v_job_exhausted) is not null,
    'exhausted job must have completed_at';
  assert (select status from public.workflow_jobs where id = v_job_paused) = 'leased',
    'paused-run job must stay leased';
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/workflow_job_lease_recovery.sql
git commit -m "Add self-rolling-back SQL test for lease recovery

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Прогон SQL-теста (red → green)

**Files:** нет изменений

- [ ] **Step 1 (RED): прогнать только тест, без миграции**

🛑 **Контрольная точка 1.** Спросить пользователя: «Запускаю SQL-тест на production-базе. Он всегда откатывается и ничего не сохраняет. Ок?» Ждать «да».

Через MCP `execute_sql` (project `qavfajsflzbefgegkwjt`) выполнить **только содержимое** `supabase/tests/workflow_job_lease_recovery.sql`.
Expected: ошибка с сообщением, содержащим `expected stale job` (старая функция не забирает `leased`), **или** `function public.fail_exhausted_workflow_jobs() does not exist`. Главное, что сообщение **не** `LEASE_RECOVERY_TESTS_PASSED`.

- [ ] **Step 2 (GREEN): прогнать миграцию и тест одним запросом**

Через MCP `execute_sql` выполнить одним `query` склейку: содержимое миграции + перевод строки + содержимое теста.
Expected: ошибка ровно `LEASE_RECOVERY_TESTS_PASSED`. Любое другое сообщение означает провал: читать текст assert'а, чинить миграцию (Task 1), коммитить исправление, повторять Step 2.

- [ ] **Step 3: Убедиться, что на production ничего не изменилось**

```sql
select
  position('LeaseExpired' in pg_get_functiondef('public.claim_workflow_job(text)'::regprocedure)) = 0 as claim_unchanged,
  to_regprocedure('public.fail_exhausted_workflow_jobs()') is null as sweep_absent,
  (select count(*) from public.ai_tasks where title like 'lease-test %') = 0 as no_fixtures,
  (select count(*) from public.workflow_jobs where status = 'leased') as leased_jobs;
```
Expected: `true, true, true, 5`.

---

### Task 4: Worker — рефакторинг блокировки, sweep и событие recovery (TDD)

**Files:**
- Create: `backend/tests/test_workflow_worker.py`
- Modify: `backend/config.py` (добавить поле после `AI_WORKFLOW_POLL_INTERVAL_SECONDS`)
- Modify: `backend/services/workflow_worker.py`

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_workflow_worker.py`:

```python
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from backend.config import settings
from backend.services.workflow_worker import WorkflowWorker

ORG = "org-1"


def make_job(**overrides):
    job = {
        "id": "job-1",
        "organization_id": ORG,
        "workflow_run_id": "run-1",
        "task_id": "task-1",
        "job_type": "execute",
        "status": "leased",
        "attempts": 1,
        "max_attempts": 3,
        "timeout_seconds": 900,
        "last_error": None,
    }
    job.update(overrides)
    return job


class FakeStore:
    def __init__(self, exhausted=None, rpc_error=None):
        self.exhausted = exhausted or []
        self.rpc_error = rpc_error
        self.rpc_calls = []
        self.updates = []
        self.rows = {
            "ai_tasks": {"task-1": {"id": "task-1", "organization_id": ORG}},
            "workflow_runs": {
                "run-1": {"id": "run-1", "organization_id": ORG, "root_task_id": "task-1"}
            },
        }

    async def rpc(self, name, payload):
        self.rpc_calls.append(name)
        if self.rpc_error:
            raise self.rpc_error
        if name == "fail_exhausted_workflow_jobs":
            return list(self.exhausted)
        return []

    async def one(self, table, *, organization_id, row_id, **kwargs):
        return self.rows[table][row_id]

    async def update(self, table, *, organization_id, filters, payload):
        self.updates.append((table, filters, payload))
        return [payload]

    def updates_for(self, table):
        return [(filters, payload) for name, filters, payload in self.updates if name == table]


def make_worker(store):
    commander = AsyncMock()
    return WorkflowWorker(store=store, commander=commander), commander


class SweepTests(unittest.IsolatedAsyncioTestCase):
    async def test_sweep_blocks_task_of_exhausted_job(self):
        store = FakeStore(exhausted=[make_job(status="failed", attempts=3, max_attempts=3)])
        worker, commander = make_worker(store)

        await worker._maybe_sweep(0)

        self.assertEqual(store.rpc_calls, ["fail_exhausted_workflow_jobs"])
        self.assertEqual(store.updates_for("workflow_jobs"), [])
        task_updates = store.updates_for("ai_tasks")
        self.assertEqual(len(task_updates), 1)
        self.assertEqual(task_updates[0][0], {"id": "eq.task-1"})
        self.assertEqual(task_updates[0][1]["status"], "blocked")
        commander._block_workflow.assert_awaited_once()
        event_types = [call.args[1] for call in commander.create_event.await_args_list]
        self.assertEqual(event_types, ["blocked"])

    async def test_sweep_runs_only_on_worker_zero_and_is_throttled(self):
        store = FakeStore()
        worker, _ = make_worker(store)
        now = [1000.0]
        worker._clock = lambda: now[0]

        with patch.object(settings, "AI_WORKFLOW_SWEEP_INTERVAL_SECONDS", 60.0):
            await worker._maybe_sweep(1)
            self.assertEqual(store.rpc_calls, [])

            await worker._maybe_sweep(0)
            await worker._maybe_sweep(0)
            self.assertEqual(len(store.rpc_calls), 1)

            now[0] += 61
            await worker._maybe_sweep(0)
            self.assertEqual(len(store.rpc_calls), 2)

    async def test_sweep_errors_are_swallowed(self):
        store = FakeStore(rpc_error=RuntimeError("db down"))
        worker, commander = make_worker(store)

        await worker._maybe_sweep(0)

        commander._block_workflow.assert_not_awaited()


class ProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovered_job_emits_event_before_processing(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        job = make_job(
            attempts=2,
            last_error={"type": "LeaseExpired", "previous_worker": "dead-worker"},
        )

        await worker._process(job)

        names = [call[0] for call in commander.mock_calls]
        self.assertIn("create_event", names)
        self.assertLess(names.index("create_event"), names.index("process_job"))
        self.assertEqual(commander.create_event.await_args.args[1], "recovered")
        self.assertEqual(store.updates_for("workflow_jobs")[0][1]["status"], "succeeded")

    async def test_regular_job_emits_no_recovery_event(self):
        store = FakeStore()
        worker, commander = make_worker(store)

        await worker._process(make_job())

        commander.create_event.assert_not_awaited()
        commander.process_job.assert_awaited_once()

    async def test_failure_with_attempts_left_requeues(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        commander.process_job.side_effect = RuntimeError("boom")

        await worker._process(make_job(attempts=1, max_attempts=3))

        job_updates = store.updates_for("workflow_jobs")
        self.assertEqual(len(job_updates), 1)
        self.assertEqual(job_updates[0][1]["status"], "queued")
        commander._block_workflow.assert_not_awaited()

    async def test_failure_on_last_attempt_blocks(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        commander.process_job.side_effect = RuntimeError("boom")

        await worker._process(make_job(attempts=3, max_attempts=3))

        job_updates = store.updates_for("workflow_jobs")
        self.assertEqual(job_updates[0][1]["status"], "failed")
        self.assertEqual(store.updates_for("ai_tasks")[0][1]["status"], "blocked")
        commander._block_workflow.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
.venv/bin/python -m unittest backend.tests.test_workflow_worker -v 2>&1 | tail -15
```
Expected: FAIL/ERROR в `SweepTests` (`AttributeError: 'WorkflowWorker' object has no attribute '_maybe_sweep'` и `settings` без `AI_WORKFLOW_SWEEP_INTERVAL_SECONDS`) и в `test_recovered_job_emits_event_before_processing`. Регрессионные `test_failure_*` и `test_regular_job_emits_no_recovery_event` должны **пройти** уже сейчас.

- [ ] **Step 3: Добавить настройку в `backend/config.py`**

Сразу после блока `AI_WORKFLOW_POLL_INTERVAL_SECONDS: float = Field(...)` вставить:

```python
    AI_WORKFLOW_SWEEP_INTERVAL_SECONDS: float = Field(
        default=60.0,
        validation_alias="AI_WORKFLOW_SWEEP_INTERVAL_SECONDS",
    )
```

- [ ] **Step 4: Изменить `backend/services/workflow_worker.py`**

4a. Импорты: добавить `import time` после `import socket`.

4b. В `__init__` после `self._worker_prefix = …` добавить:

```python
        self._clock = time.monotonic
        self._last_sweep = float("-inf")
```

4c. В `_loop`, сразу после `while not self._stop.is_set():` и перед `try:`, **внутри** существующего `try` первой строкой добавить вызов sweep. Итоговый цикл:

```python
        while not self._stop.is_set():
            try:
                await self._maybe_sweep(index)
                job = await self._claim(worker_id)
                if not job:
                    await asyncio.sleep(poll)
                    continue
                await self._process(job)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("Orbit queue worker loop failed: %s", redact_error(error))
                await asyncio.sleep(min(poll * 2, 5.0))
```

4d. Добавить метод `_maybe_sweep` после `claim_once`:

```python
    async def _maybe_sweep(self, index: int) -> None:
        """Fail abandoned jobs that ran out of attempts; one worker per process sweeps."""
        if index != 0:
            return
        now = self._clock()
        interval = max(5.0, settings.AI_WORKFLOW_SWEEP_INTERVAL_SECONDS)
        if now - self._last_sweep < interval:
            return
        self._last_sweep = now
        try:
            rows = await self.store.rpc("fail_exhausted_workflow_jobs", {})
            for job in rows or []:
                error = job.get("last_error") or {}
                await self._block_exhausted(
                    job,
                    {
                        "type": error.get("type", "LeaseExpired"),
                        "message": error.get("message", "Worker потерян, попытки исчерпаны"),
                    },
                    mark_job_failed=False,
                )
        except Exception as error:
            logger.warning("Workflow lease sweep failed: %s", redact_error(error))
```

4e. Заменить весь метод `_process` и добавить `_block_exhausted`:

```python
    async def _process(self, job: dict[str, Any]) -> None:
        await self._report_recovery(job)
        try:
            await asyncio.wait_for(
                self.commander.process_job(job),
                timeout=max(30, int(job.get("timeout_seconds") or 900)),
            )
            await self.store.update(
                "workflow_jobs",
                organization_id=job["organization_id"],
                filters={"id": f"eq.{job['id']}", "status": "eq.leased"},
                payload={"status": "succeeded", "completed_at": datetime.now(timezone.utc).isoformat()},
            )
        except Exception as error:
            attempts = int(job.get("attempts") or 1)
            max_attempts = int(job.get("max_attempts") or 3)
            safe_error = {"type": type(error).__name__, "message": redact_error(error)}
            if attempts < max_attempts:
                delay = min(2**attempts, 60)
                await self.store.update(
                    "workflow_jobs",
                    organization_id=job["organization_id"],
                    filters={"id": f"eq.{job['id']}"},
                    payload={
                        "status": "queued",
                        "available_at": (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat(),
                        "locked_at": None,
                        "locked_by": None,
                        "last_error": safe_error,
                    },
                )
                logger.warning("Workflow job %s will retry: %s", job["id"], safe_error["message"])
                return

            await self._block_exhausted(job, safe_error)

    async def _report_recovery(self, job: dict[str, Any]) -> None:
        error = job.get("last_error") or {}
        if error.get("type") != "LeaseExpired":
            return
        logger.warning(
            "Recovered stale workflow job %s from %s",
            job["id"],
            error.get("previous_worker") or "unknown worker",
        )
        try:
            task = await self.store.one(
                "ai_tasks",
                organization_id=job["organization_id"],
                row_id=job["task_id"],
            )
            await self.commander.create_event(
                task,
                "recovered",
                "Этап восстановлен после потери worker'а.",
                metadata={"job_id": job["id"], "attempt": job.get("attempts")},
            )
        except Exception as event_error:
            logger.warning("Failed to record workflow recovery event: %s", redact_error(event_error))

    async def _block_exhausted(
        self,
        job: dict[str, Any],
        safe_error: dict[str, str],
        *,
        mark_job_failed: bool = True,
    ) -> None:
        if mark_job_failed:
            await self.store.update(
                "workflow_jobs",
                organization_id=job["organization_id"],
                filters={"id": f"eq.{job['id']}"},
                payload={
                    "status": "failed",
                    "last_error": safe_error,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        task = await self.store.one(
            "ai_tasks",
            organization_id=job["organization_id"],
            row_id=job["task_id"],
        )
        run = await self.store.one(
            "workflow_runs",
            organization_id=job["organization_id"],
            row_id=job["workflow_run_id"],
        )
        await self.store.update(
            "ai_tasks",
            organization_id=job["organization_id"],
            filters={"id": f"eq.{task['id']}"},
            payload={"status": "blocked", "blocker_reason": safe_error["message"]},
        )
        await self.commander.create_event(
            task,
            "blocked",
            "Этап заблокирован после исчерпания retry policy.",
            metadata={"job_id": job["id"], "error_type": safe_error["type"]},
        )
        await self.commander._block_workflow(run, task, safe_error["message"])
        logger.error("Workflow job %s exhausted retries: %s", job["id"], safe_error["message"])
```

- [ ] **Step 5: Прогнать новые тесты**

```bash
.venv/bin/python -m unittest backend.tests.test_workflow_worker -v 2>&1 | tail -15
```
Expected: `Ran 7 tests … OK`.

- [ ] **Step 6: Прогнать весь набор и compileall (как в CI)**

```bash
.venv/bin/python -m unittest discover -s backend/tests 2>&1 | tail -5
.venv/bin/python -m compileall -q backend && echo COMPILE_OK
```
Expected: результат не хуже базовой линии из Task 0 плюс 7 новых тестов; `COMPILE_OK`.

- [ ] **Step 7: Документировать настройку в `.env.example`**

После строки `AI_WORKFLOW_POLL_INTERVAL_SECONDS=1.5` добавить:

```
# How often worker 0 fails abandoned jobs that exhausted their attempts.
AI_WORKFLOW_SWEEP_INTERVAL_SECONDS=60
```

- [ ] **Step 8: Commit**

```bash
git add backend/config.py backend/services/workflow_worker.py backend/tests/test_workflow_worker.py .env.example
git commit -m "Recover abandoned workflow jobs in the worker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Применить миграцию на production

**Files:** возможно, переименование файла миграции.

- [ ] **Step 1:** 🛑 **Контрольная точка 2.** Спросить: «SQL-тест зелёный, Python-тесты зелёные. Применяю миграцию `workflow_job_lease_recovery` к production Supabase? Изменение additive: заменяются 2 функции и добавляется индекс.» Ждать «да».

- [ ] **Step 2:** MCP `apply_migration`, project `qavfajsflzbefgegkwjt`, `name = "workflow_job_lease_recovery"`, `query` = содержимое `supabase/migrations/20260914120000_workflow_job_lease_recovery.sql`.
Expected: успех.

- [ ] **Step 3: Выровнять версию файла с записанной в базе**

MCP `list_migrations` → найти запись `workflow_job_lease_recovery` и её `version` (например, `20260914153012`). Если она отличается от `20260914120000`:

```bash
git mv supabase/migrations/20260914120000_workflow_job_lease_recovery.sql \
       supabase/migrations/<VERSION>_workflow_job_lease_recovery.sql
git commit -m "Align lease recovery migration version with remote

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Проверить функции на production**

```sql
select
  position('LeaseExpired' in pg_get_functiondef('public.claim_workflow_job(text)'::regprocedure)) > 0 as claim_updated,
  to_regprocedure('public.fail_exhausted_workflow_jobs()') is not null as sweep_present,
  (select count(*) from pg_indexes where indexname = 'workflow_jobs_leased_idx') = 1 as index_present;
```
Expected: `true, true, true`.

Важно: с этого момента **Render со старым кодом уже может пере-захватить** 5 застрявших job'ов, потому что их lease давно просрочен. Поэтому Task 6 выполнять сразу после Task 5. Если Render успел что-то забрать, это видно в Task 6, Step 1.

---

### Task 6: Отменить застрявшие задачи от 2026-08-28

**Files:** нет

- [ ] **Step 1: Показать затрагиваемые строки**

```sql
select 'task' as kind, t.id, t.title, t.status, t.workflow_run_id
  from public.ai_tasks t
 where t.organization_id = 'f009bee0-c0d0-47eb-a5d0-4e291a43a700'
   and t.status in ('queued', 'in_progress')
   and t.created_at < '2026-08-29'
union all
select 'job', j.id, j.job_type, j.status || ' by ' || coalesce(j.locked_by, '-'), j.workflow_run_id
  from public.workflow_jobs j
 where j.status in ('queued', 'leased')
   and j.created_at < '2026-08-29'
union all
select 'run', r.id, r.current_phase, r.status, r.id
  from public.workflow_runs r
 where r.status not in ('completed', 'cancelled', 'failed')
   and r.created_at < '2026-08-29'
   and r.id in (select workflow_run_id from public.ai_tasks
                 where status in ('queued', 'in_progress') and created_at < '2026-08-29')
order by kind, id;
```
Expected: 19 task, ≤5 job, ≤5 run. Показать пользователю итоговые количества и список run'ов.

- [ ] **Step 2:** 🛑 **Контрольная точка 3.** Спросить: «Отменяю эти N задач, M job'ов и K run'ов?» Ждать «да».

- [ ] **Step 3: Выполнить отмену одним запросом (атомарно)**

```sql
with stuck_tasks as (
  select id, workflow_run_id from public.ai_tasks
   where organization_id = 'f009bee0-c0d0-47eb-a5d0-4e291a43a700'
     and status in ('queued', 'in_progress')
     and created_at < '2026-08-29'
),
stuck_runs as (
  select distinct workflow_run_id as id from stuck_tasks where workflow_run_id is not null
),
jobs as (
  update public.workflow_jobs set status = 'cancelled', completed_at = now(),
         last_error = jsonb_build_object('type', 'Cancelled', 'message', 'Отменено: зависли 28.08, контекст устарел')
   where status in ('queued', 'leased') and workflow_run_id in (select id from stuck_runs)
  returning id
),
agent_runs as (
  update public.agent_runs set status = 'cancelled', completed_at = now()
   where status in ('assigned', 'working') and workflow_run_id in (select id from stuck_runs)
  returning id
),
tasks as (
  update public.ai_tasks set status = 'cancelled', cancelled_at = now(),
         blocker_reason = 'Отменено: зависли 28.08, контекст устарел'
   where id in (select id from stuck_tasks)
  returning id
),
runs as (
  update public.workflow_runs set status = 'cancelled', current_phase = 'cancelled', completed_at = now()
   where id in (select id from stuck_runs) and status not in ('completed', 'cancelled', 'failed')
  returning id
)
select (select count(*) from jobs) jobs, (select count(*) from agent_runs) agent_runs,
       (select count(*) from tasks) tasks, (select count(*) from runs) runs;
```
Expected: `tasks = 19`; `jobs`, `runs` совпадают с Step 1.

- [ ] **Step 4: Проверка**

```sql
select
  (select count(*) from public.workflow_jobs where status = 'leased'
     and locked_at + make_interval(secs => timeout_seconds + 60) < now()) as stale_leases,
  (select count(*) from public.ai_tasks where status in ('queued','in_progress')
     and created_at < '2026-08-29') as old_active_tasks;
```
Expected: `0, 0`.

---

### Task 7: Локальный запуск — launch.json

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: Исправить путь к uvicorn**

Заменить содержимое `.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "backend",
      "runtimeExecutable": "/Users/dmytrolishchyna/Desktop/Infinity Technology/orbit-crm/.venv/bin/uvicorn",
      "runtimeArgs": ["backend.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"],
      "port": 8000
    },
    {
      "name": "frontend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add -f .claude/launch.json
git commit -m "Point backend launch config at the repo venv

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Локальные переменные окружения (делает пользователь)

**Files:** `<repo>/.env` (не коммитится)

- [ ] **Step 1:** 🛑 **Контрольная точка 4.** Попросить пользователя:

```bash
cp .env.example .env
```

и заполнить в `.env` значения **сам** (агент секреты не вводит и не читает вслух):

| Переменная | Значение |
|---|---|
| `VITE_SUPABASE_URL`, `SUPABASE_URL` | `https://qavfajsflzbefgegkwjt.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | publishable key проекта |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (секрет) |
| `INTERNAL_API_TOKEN` | любой `openssl rand -hex 32`, одинаковый для фронта и backend |
| `NVIDIA_API_KEY` | ключ NVIDIA (секрет) |
| `NVIDIA_MODEL` | как на Render, например `openai/gpt-oss-120b` |
| `AI_WORKFLOW_BACKEND_URL` | `http://127.0.0.1:8000` |
| `AI_WORKFLOW_WORKER_ENABLED` / `AI_WORKFLOW_AUTORUN` | `true` / `true` |

Ждать подтверждения «готово».

- [ ] **Step 2: Проверить наличие ключей без вывода значений**

```bash
for k in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY INTERNAL_API_TOKEN NVIDIA_API_KEY AI_WORKFLOW_BACKEND_URL; do
  grep -Eq "^$k=.+" .env && echo "$k: set" || echo "$k: MISSING"
done
```
Expected: все `set`.

---

### Task 9: Локальный smoke-тест и тест recovery

**Files:** нет

- [ ] **Step 1: Запустить backend и frontend**

`preview_start` с `name: "backend"`, затем `preview_start` с `name: "frontend"`.
Проверка: `curl -s http://127.0.0.1:8000/api/ai-workflow/system-status`. Expected: `supabase.connected: true`, `nvidia.connected: true`. В `preview_logs` backend есть `Orbit Commander queue started with 4 workers`.

- [ ] **Step 2: Вход.** Открыть `http://localhost:5173/ai-workflow` (без `?preview=1`). Если редирект на логин, попросить пользователя войти самому. Проверить через `read_page`, что нет баннера demo-режима.

- [ ] **Step 3: Smoke-задача.** Через UI («Новая задача») создать задачу `Smoke lease recovery 1: составить короткий список из 3 идей для email-рассылки` с автоназначением. Затем опрашивать раз в ~30 с (не чаще):

```sql
select t.title, t.status, r.status run_status, r.current_phase,
       (select json_agg(json_build_object('type', j.job_type, 'status', j.status, 'by', j.locked_by) order by j.created_at)
          from public.workflow_jobs j where j.workflow_run_id = r.id) jobs
  from public.ai_tasks t join public.workflow_runs r on r.id = t.workflow_run_id
 where t.title like 'Smoke lease recovery 1%';
```
Expected: `plan` → `execute` → `qa` → `finalize` `succeeded`, root задача `done` (или `approval_required`, если commander счёл действие рискованным: тогда одобрить через UI). Лимит ожидания 20 мин. Если задача ушла в `blocked`, смотреть `blocker_reason` и `preview_logs`, дальше по superpowers:systematic-debugging.

- [ ] **Step 4: Тест «уронённого» worker'а.** Создать задачу `Smoke lease recovery 2: написать 5 вариантов темы письма`. Опрашивать job'ы, пока у `execute` не появится `status = 'leased'`. Сразу:
  1. `preview_stop` backend-сервера.
  2. Сдвинуть lease в прошлое:
     ```sql
     update public.workflow_jobs set locked_at = now() - interval '20 minutes'
      where status = 'leased' and job_type = 'execute'
        and task_id in (select id from public.ai_tasks where title like 'Smoke lease recovery 2%' or parent_task_id in
                        (select id from public.ai_tasks where title like 'Smoke lease recovery 2%'))
     returning id, attempts, locked_by;
     ```
  3. `preview_start` backend.

  Expected в течение ~1 мин: у этого job'а `attempts` увеличился на 1, `last_error->>'type' = 'LeaseExpired'`, `previous_worker` равен старому worker'у, новый `locked_by` — локальный hostname **или** `srv-…` (Render). Оба варианта ок. В `task_events` появилось событие `recovered`:
  ```sql
  select event_type, message, created_at from public.task_events
   where event_type = 'recovered' order by created_at desc limit 3;
  ```
  Если job забрал локальный worker, событие `recovered` обязательно. Если Render (старый код), события не будет, но `LeaseExpired` в `last_error` будет. Задача дошла до `done`.

- [ ] **Step 5: Тест исчерпанного job'а.** Создать `Smoke lease recovery 3: одна строка приветствия`. Когда любой её job в `leased`:
  1. `preview_stop` backend.
  2. ```sql
     update public.workflow_jobs set attempts = max_attempts, locked_at = now() - interval '20 minutes'
      where status = 'leased'
        and task_id in (select id from public.ai_tasks where title like 'Smoke lease recovery 3%' or parent_task_id in
                        (select id from public.ai_tasks where title like 'Smoke lease recovery 3%'))
     returning id;
     ```
  3. `preview_start` backend.

  Expected в течение ~1 мин (sweep запускается при старте worker'а 0): job `failed` с `LeaseExpired`, его задача `blocked`, run `blocked`, событие `blocked`. В UI задача видна как заблокированная.

  Оговорка: если Render (старый код, без sweep'а) раньше вызовет новую `claim` — не вызовет, т.к. `attempts >= max_attempts` исключает job из claim. Значит, только локальный sweep может его обработать. Это ожидаемо.

- [ ] **Step 6: Скриншот UI** `/ai-workflow` с задачами smoke 1–3 (`computer screenshot`). Приложить к отчёту.

- [ ] **Step 7: Остановить локальный backend** (`preview_stop`), чтобы он не конкурировал с Render после деплоя.

---

### Task 10: Документация

**Files:**
- Modify: `README.md` (раздел AI Workflow, после абзаца про `AI_WORKFLOW_TEST_FAIL_MODEL`)
- Modify: `TASKS.md` (раздел P0)

- [ ] **Step 1: README.** После строки с `AI_WORKFLOW_TEST_FAIL_MODEL` (и её продолжения) добавить пункт списка:

```markdown
- `AI_WORKFLOW_SWEEP_INTERVAL_SECONDS` (по умолчанию 60) — как часто worker
  проверяет потерянные этапы. Если worker пропал посреди выполнения (например,
  Render усыпил инстанс), `claim_workflow_job` снова выдаёт этап через
  `timeout_seconds + 60с` с `last_error.type = LeaseExpired` и событием
  `recovered`; если попытки исчерпаны, этап становится `failed`, а задача и
  workflow — `blocked`.
```

- [ ] **Step 2: TASKS.md.** В разделе «P0 — Автозапуск задач через Render»:
  - отметить `[x]` пункты, фактически подтверждённые (таблицы/RPC на месте; health check проходит; smoke test — только после Task 12);
  - добавить пункт `- [x] Восстановление зависших workflow_jobs (lease recovery), см. docs/superpowers/specs/2026-09-14-workflow-lease-recovery-design.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md TASKS.md
git commit -m "Document workflow lease recovery

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Merge и деплой backend на Render

**Files:** нет

- [ ] **Step 1: Предпроверка**

```bash
git status --short
git log --oneline main..fix/workflow-lease-recovery
git fetch origin && git log --oneline main..origin/main
```
Expected: рабочее дерево чистое (кроме неотслеживаемых `.claude/settings.json`, `ORBIT CRM JARVIS.md`, которые не трогаем); `origin/main` не ушёл вперёд. Если ушёл — `git merge origin/main` в ветку, повторить Task 4 Step 6.

- [ ] **Step 2: Выяснить, как деплоится Render.** Посмотреть `.github/workflows/*.yml` на deploy-хуки и `render.yaml` (`autoDeploy`). Сообщить пользователю: «push в main запустит автодеплой Render / нужен ручной Deploy в дашборде».

- [ ] **Step 3:** 🛑 **Контрольная точка 5.** Спросить: «Сливаю `fix/workflow-lease-recovery` в `main` (fast-forward/merge-коммит, без переписывания истории) и пушу в origin? Это синхронизируется в Lovable и, вероятно, задеплоит Render.» Ждать «да».

- [ ] **Step 4: Merge и push**

```bash
git switch main
git merge --no-ff fix/workflow-lease-recovery -m "Merge workflow lease recovery

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: Дождаться деплоя и проверить**

Опрос раз в 60 с, до 15 мин:
```bash
curl -s -m 60 https://aura-crm-hn11.onrender.com/api/health
curl -s -m 60 https://aura-crm-hn11.onrender.com/api/ai-workflow/system-status
```
Expected: `status: ok`; supabase/nvidia `connected`. Факт нового кода: после деплоя в `task_events` при следующем recovery есть `recovered` от `srv-…`. Прямой проверки версии нет. Если в дашборде Render деплой не стартовал, дать пользователю инструкцию «Manual Deploy → Deploy latest commit».

---

### Task 12: Production — Vercel и smoke-тест

**Files:** нет

- [ ] **Step 1: Найти прод-фронт.** Vercel MCP: `list_teams` → `list_projects` → проект, чей git-репозиторий `infinitytechmain2024/aura-crm` (или имя с `orbit`/`aura`). Получить прод-домен. (`aura-crm.vercel.app` — чужое приложение «Project Storage».)

- [ ] **Step 2: Проверить прокси**

```bash
curl -s -m 60 -w "\nHTTP %{http_code}\n" https://<PROD_DOMAIN>/api/backend/api/health
```
Expected: JSON `{"status":"ok","service":"orbit-crm-backend",...}`, HTTP 200. Если HTML/404/502, сообщить пользователю: проверить в Vercel `AI_WORKFLOW_BACKEND_URL=https://aura-crm-hn11.onrender.com` и совпадение `INTERNAL_API_TOKEN` с Render.

- [ ] **Step 3: Прод smoke.** Пользователь открывает `https://<PROD_DOMAIN>/ai-workflow` (вход делает сам) и создаёт задачу `Prod smoke: 3 идеи для поста в соцсети`. Агент опрашивает SQL из Task 9 Step 3 (с `like 'Prod smoke%'`) раз в ~30 с.
Expected: у всех job'ов `locked_by` начинается с `srv-` или `api:`; задача `done` без ручного запуска.

- [ ] **Step 4: Финальная проверка критериев**

```sql
select
  (select count(*) from public.workflow_jobs where status = 'leased'
     and locked_at + make_interval(secs => timeout_seconds + 60) < now()) as stale_leases,
  (select status from public.ai_tasks where title like 'Prod smoke%' order by created_at desc limit 1) as prod_smoke;
```
Expected: `0, done`.

- [ ] **Step 5:** Обновить в `TASKS.md` пункт smoke test `[x]`, commit и push (с подтверждением пользователя, как в Task 11).

- [ ] **Step 6:** superpowers:verification-before-completion — пройти все «Критерии готовности» из spec, приложив фактические результаты команд. Затем предложить переход к подпроекту A (AI-чат).
