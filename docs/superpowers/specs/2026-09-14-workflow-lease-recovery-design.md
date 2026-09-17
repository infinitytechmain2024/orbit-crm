# AI Workflow: восстановление зависших job'ов (lease recovery)

- Дата: 2026-09-14
- Статус: дизайн одобрен, ожидает review spec
- Ветка: `fix/workflow-lease-recovery`
- Подпроект: **B** (рабочий конвейер). Подпроект **A** (настоящий AI-чат в
  `WorkflowChatPanel`) делается отдельным циклом brainstorm → spec → plan после B.

## Проблема

Конвейер AI Workflow (`ai_tasks` → `workflow_runs` → `workflow_jobs` plan/execute/qa/finalize)
стоит с 2026-08-28.

Диагностика (Supabase `qavfajsflzbefgegkwjt`, Render `aura-crm-hn11`):

- Инфраструктура жива: `/api/health` 200, `system-status` — Supabase и NVIDIA `connected`,
  таблицы и RPC `claim_workflow_job` на месте, ранее 20 задач дошли до `done`.
- 5 job'ов `execute` навсегда в `status = 'leased'`. `locked_by` — pod
  `srv-…-hibernate-…`: Render усыпил/перезапустил инстанс посреди выполнения.
- `claim_workflow_job` выбирает только `status = 'queued'`. Механизма возврата просроченных
  lease нет ни в SQL, ни в `backend/services/workflow_worker.py`; `timeout_seconds = 900`
  нигде не используется для recovery.
- Как следствие, 14 зависимых подзадач так и не получили job'ов. Итого 19 задач в
  `queued`/`in_progress`.

## Цели

1. Job, чей worker пропал, автоматически возвращается в работу после `timeout_seconds + 60с`.
2. Если попытки исчерпаны, job становится `failed`, а задача и run — `blocked`
   (та же семантика, что у обычной ошибки после retry policy).
3. Застрявшие задачи от 28.08 отменяются.
4. Конвейер проверен локально (включая «уронённый» worker) и на production.

## Не цели

- Heartbeat / короткий lease. Задержка recovery до ~16 мин допустима для фоновой очереди;
  вернёмся, если будет мешать.
- Изменения фронтенда, в том числе чата (это подпроект A).
- Борьба с засыпанием Render-инстанса.

## Выбранный подход

Recovery внутри SQL-функции `claim_workflow_job` + отдельная функция для исчерпанных job'ов.
Сигнатура RPC не меняется, поэтому после миграции уже работающий на Render код начинает
восстанавливать job'ы ещё до редеплоя. Выбор атомарный (`for update skip locked`), без гонок
между несколькими worker'ами.

Отклонённые варианты: reaper-цикл в Python (нужен редеплой, условные update'ы между
инстансами, больше кода); подход с heartbeat (больше движущихся частей, YAGNI).

## Дизайн

### 1. База данных — одна additive-миграция

Файл: `supabase/migrations/20260914<hhmmss>_workflow_job_lease_recovery.sql`.

**`public.claim_workflow_job(p_worker_id text)`** — `create or replace`, та же сигнатура,
`security invoker`, `set search_path = ''`, grants без изменений (только `service_role`).
Кандидат выбирается так:

```sql
where (
    (candidate.status = 'queued' and candidate.available_at <= now())
 or (candidate.status = 'leased'
     and candidate.attempts < candidate.max_attempts
     and candidate.locked_at + make_interval(secs => candidate.timeout_seconds + 60) < now())
)
and run.status not in ('paused', 'cancelled', 'completed', 'failed')
order by candidate.available_at, candidate.created_at
for update of candidate skip locked
limit 1
```

При пере-захвате ранее leased job'а:
`last_error = {"type": "LeaseExpired", "previous_worker": <старый locked_by>}`.
Для job'ов из `queued` `last_error` не трогается.

**`public.fail_exhausted_workflow_jobs()`** — `returns setof public.workflow_jobs`, только
`service_role`. Одним `update … returning` переводит в `failed` job'ы с `status = 'leased'`,
`attempts >= max_attempts` и просроченным lease (то же условие времени):
`last_error = {"type": "LeaseExpired", "message": "Worker потерян, попытки исчерпаны"}`,
`completed_at = now()`.

**Осиротевшие `agent_runs`.** При пере-захвате и при `fail_exhausted…` записи `agent_runs`
этой задачи в статусе «running» помечаются как неуспешные с причиной «lease expired».
Точные имена колонок и допустимые значения статуса сверяются со схемой на этапе плана.
Если колонки задачи в `agent_runs` нет, пункт выносится в worker.

**Индекс:** частичный `workflow_jobs (locked_at) where status = 'leased'`.

**Почему +60с:** worker сам обрывает job по `asyncio.wait_for(timeout_seconds)` и записывает
retry/fail. Запас не даёт другому worker'у забрать job, пока живой worker ещё пишет итог.

### 2. Worker — `backend/services/workflow_worker.py`

1. **`_block_exhausted(job, safe_error)`** — логика из ветки «retries exhausted» в
   `_process` (job → `failed`, задача → `blocked` + `blocker_reason`, событие `blocked`,
   `commander._block_workflow`) выносится в метод. `_process` вызывает его, и поведение
   для обычных ошибок не меняется. Для job'ов из `fail_exhausted…` обновление самого job'а
   пропускается: он уже `failed`.
2. **Sweep.** В `_loop` worker с индексом `0` не чаще раза в
   `AI_WORKFLOW_SWEEP_INTERVAL_SECONDS` (по умолчанию 60, настройка в `backend/config.py`)
   вызывает `store.rpc("fail_exhausted_workflow_jobs", {})` и для каждой строки вызывает
   `_block_exhausted`. Исключения логируются через `redact_error` и не прерывают цикл.
3. **Видимость recovery.** Если у захваченного job'а `last_error.type == "LeaseExpired"`:
   `logger.warning("Recovered stale workflow job %s from %s", …)` и
   `commander.create_event(task, "recovered", "Этап восстановлен после потери worker'а.")`
   до обработки.

### 3. Тесты

**Python** — `backend/tests/test_workflow_worker.py` (unittest + `AsyncMock`, стиль
`test_orbit_commander.py`):

- sweep: строка из RPC → `_block_exhausted` → задача и run `blocked`;
- sweep выполняется только worker'ом 0 и не чаще интервала;
- захваченный job с `LeaseExpired` → событие `recovered`, затем `process_job`;
- регрессия: ошибка при `attempts < max_attempts` → `queued` с backoff;
- регрессия: ошибка при `attempts == max_attempts` → `_block_exhausted`.

**SQL** — `supabase/tests/workflow_job_lease_recovery.sql`, выполняется в `begin … rollback`
(Supabase-ветка или локальный стек, на проде — только с `rollback`). Фикстуры: run + jobs.
Проверки:

- просроченный leased (`attempts < max`) забирается, `attempts` +1, `last_error.type = LeaseExpired`;
- свежий leased не забирается;
- queued по-прежнему забирается, приоритет по `available_at`;
- job run'а в `paused` не забирается;
- исчерпанный просроченный job возвращается из `fail_exhausted…` и становится `failed`;
- `anon`/`authenticated` не могут вызвать ни одну из функций.

### 4. Очистка застрявших задач (production, после подтверждения)

Выполняется **после** миграции. Сначала `select` с показом затрагиваемых строк, затем update:

- `workflow_jobs` в `leased`/`queued` этих run'ов → `cancelled`;
- 19 задач `ai_tasks` в `queued`/`in_progress` (созданы 2026-08-28) → `cancelled`,
  `blocker_reason = 'Отменено: зависли 28.08, контекст устарел'`;
- их `workflow_runs` → `cancelled`;
- «running» `agent_runs` → неуспешный статус.

Допустимые значения сверяются с check-constraint'ами до выполнения.

### 5. Локальная проверка

- Шаблон `.env.local` и `backend/.env` (только имена переменных; секреты вписывает
  пользователь): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
  `INTERNAL_API_TOKEN`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`,
  `AI_WORKFLOW_BACKEND_URL=http://127.0.0.1:8000`, `AI_WORKFLOW_WORKER_ENABLED=true`,
  `AI_WORKFLOW_AUTORUN=true`.
- `.claude/launch.json` с `npm run dev:full`; запуск через preview. Вход в CRM выполняет
  пользователь.
- **Smoke:** задача в `/ai-workflow` (не `?preview=1`) проходит plan → execute → qa → finalize
  → `done`. Прогресс контролируется SQL, логами и UI.
- **Recovery:** на второй задаче при `execute` в `leased` backend останавливается,
  `locked_at` сдвигается на 20 мин назад, backend запускается. Ожидание: job пере-захвачен
  (`LeaseExpired`, событие `recovered`), задача дошла до `done`. `locked_by` покажет, кто
  забрал job: локальный worker или Render (оба используют новую SQL-функцию).
- **Exhausted:** job с `attempts = max_attempts` и сдвинутым `locked_at` → после sweep'а
  job `failed`, задача и run `blocked`.

### 6. Production

- Коммиты только в ветке `fix/workflow-lease-recovery`; без секретов. Merge в `main` и push —
  после подтверждения пользователя (репозиторий связан с Lovable, force-push и amend
  запушенного запрещены). До push проверить, включён ли автодеплой Render из
  `infinitytechmain2024/aura-crm`.
- **Render:** `/api/health` 200; `system-status` connected; в `workflow_jobs.locked_by`
  появляются `srv-…`. Env Render недоступен агенту — при расхождениях пользователь получает
  чек-лист.
- **Vercel:** через Vercel MCP найти реальный проект Orbit CRM (`aura-crm.vercel.app` — чужое
  приложение «Project Storage»), проверить `/api/backend/api/health` через прокси.
- **Прод smoke:** одна задача в `/ai-workflow` доходит до `done` без ручного запуска.
- **Документация:** отметить выполненные пункты P0 в `TASKS.md`; абзац о lease recovery в
  разделе AI Workflow в `README.md`.

## Обработка ошибок

| Ситуация | Поведение |
|---|---|
| Worker умер, попытки остались | Через `timeout_seconds + 60с` любой worker забирает job, `LeaseExpired`, событие `recovered` |
| Worker умер, попытки исчерпаны | Sweep: job `failed`, задача и run `blocked` с понятной причиной |
| Живой worker превысил таймаут | Как раньше: `asyncio.TimeoutError` → retry с backoff или `blocked` |
| RPC sweep'а упал | Лог (redacted), цикл продолжается, повтор через интервал |
| Run на паузе/отменён | Job не забирается ни из `queued`, ни из просроченного `leased` |

## Риски

- Повторный `execute` может заново вызвать LLM и coding executor: побочные эффекты первой
  попытки (например, созданные артефакты) не откатываются. Принято: без recovery задача
  зависает навсегда, что хуже.
- Локальный worker и Render делят очередь во время проверки. Для этой задачи это
  допустимо и даже полезно, но локальные тестовые задачи может выполнить Render.

## Критерии готовности

- [ ] SQL-тест и pytest зелёные.
- [ ] В базе нет `leased` job'ов старше `timeout_seconds + 60с`.
- [ ] Локально: smoke-задача `done`; «уронённый» job восстановлен; исчерпанный — `blocked`.
- [ ] Production: новая задача доходит до `done` без ручного запуска.
