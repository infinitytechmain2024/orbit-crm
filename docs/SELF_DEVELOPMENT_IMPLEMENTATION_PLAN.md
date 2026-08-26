# ORBIT CRM — план реализации Self-Development Mode

Дата: 2026-08-25  
Статус документа: рабочий execution checklist  
Целевой релиз: локальный Docker Self-Hosted Development Provider с ручным и автономным режимами разработки

## 1. Цель и итоговый сценарий

Система должна позволять владельцу поставить одну development-задачу через ORBIT CRM. CEO/Orbit Commander автоматически строит план, создаёт отделы и подзадачи, HR подбирает постоянных или временных агентов, NVIDIA gateway назначает доступные модели, а локальный Docker Provider предоставляет безопасную среду выполнения. Результат проходит автоматический QA и возвращается владельцу как diff, commits, тесты, риски и Preview.

Одновременно должны поддерживаться два режима:

1. **Manual Development** — владелец работает в основной папке репозитория через IDE.
2. **Self-Development** — агенты работают в отдельной ветке и Git worktree внутри временного Docker-контейнера.

Полный поток:

```text
Владелец → Vercel CRM → Render FastAPI/CEO → Supabase queue
                                        ↓
                              Render private OpenClaw
                                        ↓
                          NVIDIA quota-aware gateway

Local Docker Provider ← polling/lease ← Render FastAPI
        ↓
workflow container → Git worktree → agents → tests → artifacts
        ↓
Render/Supabase → CRM approval → push → Vercel Preview → verification
```

## 2. Нефункциональные требования и ограничения

- [ ] Основная рабочая папка IDE не изменяется Self-Development Runner.
- [ ] Один `workflow_run` использует одну изолированную ветку, worktree и execution environment.
- [ ] Субагенты одного workflow разделяют окружение и видят согласованный результат.
- [ ] Provider устанавливает только исходящие HTTPS-соединения; входящий порт на Mac не открывается.
- [ ] Provider не получает Supabase `service_role` и работает через защищённый FastAPI API.
- [ ] Workflow-контейнер не получает production-секреты.
- [ ] Merge в `main`, push, production migration и production deployment всегда требуют human approval.
- [ ] Force push и переписывание опубликованной Lovable-истории запрещены.
- [ ] При выключенном Mac задача остаётся в `waiting_for_provider`.
- [ ] При исчерпании NVIDIA-пула задача остаётся в `waiting_for_model`, а не завершается необратимой ошибкой.
- [ ] Все действия связываются через `organization_id`, `workflow_run_id`, `agent_id`, `correlation_id` и `idempotency_key`.
- [ ] Первый релиз ограничивается одним одновременно выполняемым development workflow.

## 3. Фаза 0 — стабилизация существующего проекта

### 3.1 TypeScript и сборка

- [ ] Добавить npm-команду `typecheck: tsc --noEmit`.
- [ ] Исправить все текущие строгие TypeScript-ошибки.
- [ ] Обновить Supabase-generated types после подтверждения production-схемы.
- [ ] Устранить расхождения типов `organization_id`, Voice API, AI Workflow и memory tables.
- [ ] Оставить production build воспроизводимым через `npm ci && npm run build`.
- [ ] Классифицировать и сократить текущие ESLint warnings.

### 3.2 CI

- [ ] Добавить `npm run typecheck` перед build в GitHub Actions.
- [ ] Сохранить отдельные jobs frontend, backend, browser smoke и infrastructure.
- [ ] Загружать test reports и build logs как CI artifacts.
- [ ] Блокировать merge при typecheck, build или backend-test failure.
- [ ] Добавить синтаксическую проверку новых Self-Development Docker/Compose-файлов.

### 3.3 Supabase baseline

- [ ] Выполнить read-only production schema check.
- [ ] Сравнить production migration history с `supabase/migrations`.
- [ ] Не применять старые пересекающиеся AI/OpenClaw migrations целиком.
- [ ] Подготовить additive repair migration только для отсутствующих объектов.
- [ ] Подтвердить наличие `ai_tasks`, `workflow_runs`, `workflow_jobs` и RPC очереди.
- [ ] Проверить RLS двумя пользователями из разных организаций.
- [ ] Проверить Security и Performance Advisors.

**Критерий фазы:** typecheck, lint, build, backend tests и текущий Playwright suite проходят; production schema inventory документирован.

## 4. Фаза 1 — доменная модель Self-Development

### 4.1 Development Provider

Создать `development_providers`:

```text
id uuid primary key
organization_id uuid not null
name text not null
provider_type text check in ('self_hosted_docker')
platform text not null
architecture text not null
capabilities text[] not null
status text check in ('offline','connecting','available','busy','draining','degraded','disabled')
max_concurrent_runs integer default 1
active_runs integer default 0
last_heartbeat_at timestamptz
token_hash text not null
metadata jsonb default '{}'
created_by uuid not null
created_at timestamptz
updated_at timestamptz
```

- [ ] Добавить unique name внутри организации.
- [ ] Добавить индекс `(organization_id, status, last_heartbeat_at)`.
- [ ] Включить RLS.
- [ ] Разрешить членам организации только SELECT.
- [ ] Запретить клиентам запись и управление токенами.
- [ ] Управление provider выполнять только backend/service role.

### 4.2 Development Run

Создать `development_runs`:

```text
id uuid primary key
organization_id uuid not null
workflow_run_id uuid not null
provider_id uuid
repository text not null
base_branch text not null
base_commit text not null
working_branch text not null
status text not null
lease_token_hash text
leased_until timestamptz
attempt integer default 0
started_at timestamptz
completed_at timestamptz
exit_code integer
error_class text
result_summary text
metadata jsonb default '{}'
created_at timestamptz
updated_at timestamptz
```

Статусы:

```text
queued → leased → preparing → running → controller_review → qa
→ awaiting_approval → approved → pushing → preview_deployed → verified → completed
```

Дополнительные состояния:

```text
waiting_for_provider
waiting_for_model
waiting_for_dependency
revision_required
paused
failed
cancelled
rolled_back
```

- [ ] Добавить уникальность активного run для одного `workflow_run_id`.
- [ ] Индексировать ready/lease queue.
- [ ] Ограничить допустимые переходы статусов backend-логикой и тестами.
- [ ] Добавить lease expiration recovery.
- [ ] Не создавать повторный run при одинаковом idempotency key.

### 4.3 Events и artifacts

- [ ] Создать `development_run_events` для agent/model/container/git/test событий.
- [ ] Создать `development_artifacts` для plan, diff, patch, commit list, migration, test report, security report, logs, Preview URL и rollback plan.
- [ ] Хранить большие артефакты в закрытом Storage bucket.
- [ ] Хранить в таблице только metadata, hash, size и storage path.
- [ ] Предоставлять пользователю краткоживущие signed URLs.
- [ ] Исключить секреты и персональные данные из logs/artifacts.

### 4.4 Runtime agents

- [ ] Добавить или расширить `agent_runtime_instances`.
- [ ] Поддержать `permanent`, `temporary`, `reserve`.
- [ ] Связать временного агента с assignment, project и department.
- [ ] Сохранять историю после архивирования runtime instance.
- [ ] Добавить метрики успешности, revisions, duration, QA failures и model fallbacks.

**Критерий фазы:** схема применяется на чистой тестовой базе; RLS и lease tests проходят; повторный запрос не создаёт дубль.

## 5. Фаза 2 — Provider API на Render FastAPI

### 5.1 Авторизация Provider

- [ ] Ввести отдельный `SELFDEV_PROVIDER_TOKEN`, не совпадающий с `INTERNAL_API_TOKEN`.
- [ ] Хранить на backend только hash токена.
- [ ] Привязать токен к provider ID и организации.
- [ ] Добавить rotation и revoke.
- [ ] Не передавать provider token в workflow-контейнер.
- [ ] Записывать успешную/неуспешную аутентификацию без значения токена.

### 5.2 Endpoints

- [ ] `POST /api/selfdev/providers/register` — регистрация и capability report.
- [ ] `POST /api/selfdev/providers/heartbeat` — status, active runs, version, resources.
- [ ] `POST /api/selfdev/jobs/lease` — атомарное получение следующей совместимой задачи.
- [ ] `POST /api/selfdev/jobs/{id}/heartbeat` — продление lease.
- [ ] `POST /api/selfdev/jobs/{id}/events` — пакетная отправка событий.
- [ ] `POST /api/selfdev/jobs/{id}/artifacts` — регистрация и загрузка артефактов.
- [ ] `POST /api/selfdev/jobs/{id}/complete` — успешное завершение execution.
- [ ] `POST /api/selfdev/jobs/{id}/fail` — классифицированная ошибка.
- [ ] `POST /api/selfdev/jobs/{id}/release` — добровольный возврат lease.
- [ ] `POST /api/selfdev/jobs/{id}/pause` — подтверждение безопасной паузы.

### 5.3 Lease policy

- [ ] Lease выдаётся транзакционно через одну RPC/function.
- [ ] Использовать `FOR UPDATE SKIP LOCKED` или эквивалент существующей queue RPC.
- [ ] Lease содержит короткоживущий run token.
- [ ] Heartbeat продлевает lease только владельцу lease.
- [ ] Истёкший lease возвращает run в очередь после idempotency reconciliation.
- [ ] Повторное завершение с тем же run token возвращает сохранённый результат.
- [ ] Provider с `draining` не получает новые jobs.

### 5.4 Наблюдаемость

- [ ] Добавлять correlation ID ко всем endpoint responses.
- [ ] Метрики: connected providers, lease latency, active runs, expired leases, failure classes.
- [ ] Alerts: provider offline, repeated lease expiry, artifact upload failure.

**Критерий фазы:** тестовый provider регистрируется, получает job, продлевает lease, завершает run; неверный токен отклоняется.

## 6. Фаза 3 — локальный `selfdev-provider`

### 6.1 Структура сервиса

- [ ] Создать отдельный пакет/модуль `selfdev/provider`.
- [ ] Реализовать configuration loader.
- [ ] Реализовать register/heartbeat loop.
- [ ] Реализовать lease polling с backoff и jitter.
- [ ] Реализовать one-run scheduler.
- [ ] Реализовать state recovery после перезапуска provider.
- [ ] Реализовать graceful shutdown и `draining`.
- [ ] Реализовать очистку завершённых execution containers.

### 6.2 Provider configuration

```text
SELFDEV_BACKEND_URL
SELFDEV_PROVIDER_TOKEN
SELFDEV_PROVIDER_NAME
SELFDEV_REPOSITORY_PATH
SELFDEV_WORKTREE_ROOT
SELFDEV_ARTIFACT_ROOT
SELFDEV_MAX_CONCURRENT_RUNS=1
SELFDEV_WORKSPACE_IMAGE
SELFDEV_HEARTBEAT_SECONDS
SELFDEV_JOB_TIMEOUT_SECONDS
SELFDEV_RETENTION_DAYS
```

- [ ] Добавить `.env.selfdev.example` без реальных секретов.
- [ ] Валидировать абсолютный repository path.
- [ ] Отказаться от запуска, если путь указывает не на ожидаемый Git repository.
- [ ] Проверять совпадение remote repository и разрешённого project ID.

### 6.3 Docker Compose

- [ ] Добавить Compose profile `selfdev`.
- [ ] Добавить сервис `selfdev-provider`.
- [ ] Добавить сервис ограниченного Docker socket proxy.
- [ ] Не включать Self-Development profile в обычный `docker compose up`.
- [ ] Добавить healthcheck provider.
- [ ] Добавить restart policy `unless-stopped`.
- [ ] Добавить persistent state/cache volumes.
- [ ] Добавить resource limits provider.

Команды целевого управления:

```bash
docker compose --profile selfdev build selfdev-provider
docker compose --profile selfdev up -d selfdev-provider
docker compose logs -f selfdev-provider
docker compose stop selfdev-provider
```

### 6.4 Docker socket security

- [ ] Не предоставлять workflow-контейнеру Docker socket.
- [ ] Provider обращается только через socket proxy.
- [ ] Разрешить create/start/inspect/logs/stop/remove только для Self-Development containers.
- [ ] Помечать контейнеры labels: `orbit.selfdev=true`, `workflow_run_id`, `provider_id`.
- [ ] Перед stop/remove проверять labels.
- [ ] Запретить privileged containers.
- [ ] Запретить host network и произвольные host mounts.
- [ ] Запретить доступ к существующим пользовательским volumes.

**Критерий фазы:** Provider запускается отдельным Compose profile, появляется Online в backend и безопасно восстанавливается после restart.

## 7. Фаза 4 — workflow workspace image

### 7.1 Состав образа

- [ ] Node.js 24 и npm.
- [ ] Python 3.12 и pinned backend dependencies.
- [ ] Git и базовые shell tools.
- [ ] Supabase CLI закреплённой версии.
- [ ] Playwright Chromium и системные зависимости.
- [ ] Инструменты проверки JSON, YAML, SQL и shell.
- [ ] Non-root пользователь `selfdev`.
- [ ] Рабочая директория `/workspace`.

### 7.2 Изоляция

- [ ] Root filesystem read-only.
- [ ] Writable: `/workspace`, `/tmp`, `/artifacts`.
- [ ] `cap_drop: ALL`.
- [ ] `no-new-privileges`.
- [ ] Ограничить CPU, RAM, PIDs и общий timeout.
- [ ] Установить network policy: backend callback, package registries и разрешённые provider endpoints.
- [ ] Запретить доступ к LAN и Docker host, кроме явно требуемых test endpoints.

### 7.3 Секреты

- [ ] Передавать только краткоживущий `SELFDEV_RUN_TOKEN`.
- [ ] Не передавать Supabase service role, provider token, Vercel/Render credentials или production DB password.
- [ ] Передавать тестовые ключи только для конкретного approved integration test.
- [ ] Удалять environment dump из логов.

### 7.4 Cache

- [ ] Использовать read/write package caches с раздельными путями.
- [ ] Не переиспользовать изменяемый `node_modules` между worktrees.
- [ ] Переиспользовать npm/pip download cache.
- [ ] Проверять lockfiles и использовать `npm ci`.

**Критерий фазы:** контейнер собирает проект, запускает тесты и не может читать файлы за пределами смонтированного worktree.

## 8. Фаза 5 — Git worktree и совместимость с IDE

### 8.1 Worktree manager

- [ ] Добавить `.selfdev/` в `.gitignore`.
- [ ] Создавать `.selfdev/worktrees/<run-id>`.
- [ ] Создавать ветку `codex/selfdev-<short-run-id>`.
- [ ] Фиксировать `base_branch` и точный `base_commit`.
- [ ] Не переключать ветку основной рабочей папки.
- [ ] Проверять, что worktree path находится внутри разрешённого root.
- [ ] Запрещать повторное использование чужого worktree.

### 8.2 Manual mode

- [ ] Ручная разработка продолжает использовать основную папку репозитория.
- [ ] Self-Development не включает незакоммиченные ручные изменения.
- [ ] В UI объяснять, что агенты начинают от выбранного commit.
- [ ] Добавить действие «Продолжить ветку через Self-Development» только для committed branch.
- [ ] Добавить действие «Открыть worktree в IDE» с точным локальным путём.
- [ ] Provider обнаруживает commits владельца в worktree и включает их в итоговый diff.

### 8.3 Конфликты

- [ ] Перед approval обновить remote refs.
- [ ] Проверить расхождение base branch.
- [ ] Не выполнять автоматический merge при конфликте.
- [ ] Создать отдельную `revision_required` задачу для разрешения конфликтов.
- [ ] Повторно запустить полный QA после разрешения конфликтов.

### 8.4 Git safety

- [ ] Запретить force push.
- [ ] Запретить rebase/amend опубликованных Lovable commits.
- [ ] Запретить `reset --hard` на пользовательских ветках.
- [ ] Автоматический commit разрешить только в selfdev-ветку.
- [ ] Push selfdev-ветки требует approval.
- [ ] Merge в `main` требует отдельного approval.

**Критерий фазы:** владелец редактирует основной workspace, пока агенты параллельно работают в worktree; изменения не пересекаются до controlled merge.

## 9. Фаза 6 — командный брокер и filesystem policy

### 9.1 Командный брокер

- [ ] Агент запрашивает структурированное действие, а не произвольный shell string.
- [ ] Поддержать command types: inspect, install, typecheck, lint, build, unit_test, e2e_test, db_test, git_status, git_diff, commit.
- [ ] Валидировать working directory.
- [ ] Валидировать arguments без shell interpolation.
- [ ] Ограничивать timeout и output size.
- [ ] Сохранять exit code, duration и redacted output.

### 9.2 Разрешения файлов

- [ ] Каждое assignment содержит `allowed_paths` и `read_only_paths`.
- [ ] Frontend agent пишет только в frontend paths.
- [ ] Backend agent пишет только в backend paths.
- [ ] Database agent пишет только в `supabase/` и связанных tests/docs.
- [ ] QA читает весь worktree, но пишет только tests и reports, если иное не назначено.
- [ ] Выход за scope немедленно переводит assignment в controller review.

### 9.3 File leases

- [ ] Перед записью агент получает lease на path/file group.
- [ ] Два агента не редактируют один файл одновременно.
- [ ] Lease освобождается после commit/checkpoint.
- [ ] Зависимые задачи получают обновлённый commit.

**Критерий фазы:** попытка команды вне allowlist или записи вне scope отклоняется и фиксируется в audit.

## 10. Фаза 7 — CEO, руководители и HR

### 10.1 CEO / Orbit Commander

- [ ] Принимать пользовательскую цель без ручного выбора агентов и моделей.
- [ ] Выполнять repository inspection перед планированием.
- [ ] Возвращать структурированный план с objective, acceptance criteria, departments, dependencies и risk.
- [ ] Назначать руководителей отделов.
- [ ] Ограничить plan revisions двумя попытками.
- [ ] Ограничить controller review тремя циклами.
- [ ] Не менять исходную цель без human approval.

### 10.2 Руководители

- [ ] Developer Lead создаёт frontend/backend/database/QA/AI integration assignments.
- [ ] Marketing Lead создаёт research/SEO/SMM/content/parsing assignments.
- [ ] Руководитель принимает результат субагента или создаёт revision.
- [ ] Руководитель собирает department artifact для CEO.
- [ ] Руководитель не выполняет push/deploy.

### 10.3 HR Agent

- [ ] Анализировать capabilities и текущую нагрузку.
- [ ] Использовать исторические QA/outcome metrics.
- [ ] Назначать свободного постоянного агента.
- [ ] При отсутствии специалиста создавать temporary runtime agent.
- [ ] Переводить освободившихся агентов в reserve.
- [ ] Повторно назначать reserve agent на совместимый проект.
- [ ] Архивировать временный runtime после retention, сохраняя историю.

### 10.4 Видимость агентов

- [ ] Каждый runtime agent имеет role, department, leader, assignment, employment type, status и model metadata.
- [ ] Временные агенты визуально отличаются от постоянных и резервных.
- [ ] В UI сохраняется дерево CEO → Lead → Agent.

**Критерий фазы:** одна задача автоматически превращается в иерархию отделов и assignments, включая создание временного агента при нехватке capability.

## 11. Фаза 8 — NVIDIA quota-aware gateway

### 11.1 Registry

- [ ] Использовать существующий `nvidia_model_registry.py` как allowlist.
- [ ] Не добавлять автоматически все NVIDIA-модели.
- [ ] Сохранить pools `heavy`, `standard`, `fast`.
- [ ] CEO/агенты запрашивают capability и pool, а не конкретную модель.

### 11.2 Runtime state

- [ ] Создать централизованное состояние `model_id`, status, cooldown, retry-after, failures, successes и latency.
- [ ] Синхронизировать состояние между FastAPI workers и OpenClaw.
- [ ] Не использовать память одного процесса как source of truth.

### 11.3 Fallback

- [ ] Переключать модель при 429, quota, supported 5xx, timeout и retired model.
- [ ] Учитывать `Retry-After`.
- [ ] Использовать exponential backoff и jitter при отсутствии `Retry-After`.
- [ ] Не переключать при 401/403, invalid request или policy rejection.
- [ ] Сохранять каждую попытку и фактически использованную модель.
- [ ] Не создавать повторный агентский результат при fallback.
- [ ] Если весь pool недоступен, перевести assignment в `waiting_for_model`.

### 11.4 OpenClaw integration

- [ ] Backend передаёт выбранную модель OpenClaw.
- [ ] OpenClaw возвращает selected/actual model и fallback attempts.
- [ ] Удалить независимую несовместимую fallback-логику либо подчинить её общему gateway state.
- [ ] Отображать model events в CRM execution feed.

**Критерий фазы:** искусственный 429 основной модели приводит к продолжению того же assignment на следующей модели без дубля.

## 12. Фаза 9 — выполнение, QA и controller review

### 12.1 Execution checkpoints

- [ ] Сохранять checkpoint после каждой принятой подзадачи.
- [ ] Сохранять commit hash, changed paths и agent ID.
- [ ] Восстанавливать workflow с последнего безопасного checkpoint.
- [ ] Не повторять завершённую assignment после restart.

### 12.2 Обязательные проверки

```text
npm run typecheck
npm run lint
npm run build
npm run test:e2e
python -m unittest discover -s backend/tests -v
python -m compileall -q backend
```

- [ ] Выбирать дополнительные тесты по changed paths.
- [ ] Для migration запускать clean apply и schema/RLS tests.
- [ ] Для security-sensitive изменений запускать cross-tenant tests.
- [ ] Для Render/Vercel config запускать syntax и smoke checks.

### 12.3 QA result

Поддержать:

```text
PASS
PASS_WITH_RISKS
REVISION_REQUIRED
FAIL
BLOCKED
```

- [ ] Только PASS и подтверждённый PASS_WITH_RISKS переходят в approval.
- [ ] REVISION_REQUIRED создаёт адресную подзадачу исходному агенту.
- [ ] После revision повторяется затронутый QA и затем полный release gate.
- [ ] FAIL не маскируется успешным AI summary.

### 12.4 Controller review

- [ ] Руководитель проверяет подзадачу перед объединением department result.
- [ ] CEO проверяет соответствие итогового результата исходной цели.
- [ ] Изменение scope или architecture требует нового plan version.

**Критерий фазы:** намеренно сломанное изменение возвращается на revision и не показывается владельцу как готовое.

## 13. Фаза 10 — AI Workflow UI

### 13.1 Provider status

- [ ] Показывать Local Docker Provider Online/Offline/Busy/Degraded.
- [ ] Показывать platform, architecture, capabilities и concurrency.
- [ ] Показывать последний heartbeat.
- [ ] При Offline показывать `waiting_for_provider`, не generic error.

### 13.2 Режим разработки

- [ ] Добавить `Manual`, `Self-Development`, `Hybrid`.
- [ ] Manual не создаёт автоматический run.
- [ ] Self-Development создаёт отдельную ветку/worktree.
- [ ] Hybrid позволяет открыть worktree в IDE и вернуть работу агентам.

### 13.3 Иерархия команды

- [ ] Сохранить существующий дизайн AI Workflow.
- [ ] CEO располагается сверху.
- [ ] Линии ведут к Developer, Marketing и HR.
- [ ] Нажатие на руководителя раскрывает его субагентов.
- [ ] Показывать постоянных, временных и резервных агентов.
- [ ] Для каждого агента показывать задачу, прогресс, модель, fallback, зависимости и результат.

### 13.4 Project task table

- [ ] Колонки: задача, execution chain, status, provider, model, progress, tests, result.
- [ ] Пример chain: `CEO → Developer → Backend Agent`.
- [ ] Добавить фильтры queued/running/approval/done/failed.

### 13.5 Execution feed и artifacts

- [ ] События создания плана и назначения агентов.
- [ ] События создания/архивирования temporary agent.
- [ ] NVIDIA fallback events с причиной.
- [ ] Container start/stop, Git checkpoint, QA и approval events.
- [ ] Артефакты: plan, diff, test report, migration, Preview URL, rollback.

### 13.6 Управление

- [ ] Запустить Self-Development.
- [ ] Pause/Resume/Cancel.
- [ ] Открыть worktree в IDE.
- [ ] Продолжить вручную.
- [ ] Вернуть агентам.
- [ ] Просмотреть diff.
- [ ] Запросить revision.
- [ ] Approve commit/push/Preview/Production отдельно.

**Критерий фазы:** владелец визуально отслеживает путь задачи от CEO до конкретного агента, модели, контейнера, тестов и результата.

## 14. Фаза 11 — approvals, push и Preview

### 14.1 Approval gates

- [ ] Изменение worktree и локальные тесты не требуют постоянных подтверждений.
- [ ] Push development-ветки требует approval.
- [ ] Merge в `main` требует отдельного approval.
- [ ] Production migration требует отдельного approval.
- [ ] Preview deployment требует approval или явно включённой project policy.
- [ ] Production deployment всегда требует approval.
- [ ] Secrets и платные интеграции всегда требуют approval.

### 14.2 Push

- [ ] Использовать ограниченный GitHub token.
- [ ] Разрешить push только `codex/selfdev-*`.
- [ ] Проверить remote и branch protection перед push.
- [ ] Записать commit hashes и remote response.
- [ ] Не force-push.

### 14.3 Vercel Preview

- [ ] Создавать Preview только из approved development branch.
- [ ] Сохранить Preview URL как artifact.
- [ ] Выполнить frontend smoke и backend proxy checks.
- [ ] При smoke failure вернуть run в revision_required.
- [ ] Не переключать production domain.

### 14.4 Rollback

- [ ] Сохранять base commit, final commit и migration rollback notes.
- [ ] Preview rollback выполняется удалением/отменой Preview deployment.
- [ ] Production rollback остаётся ручным approval workflow.

**Критерий фазы:** approved branch отправляется в GitHub, Vercel Preview проходит smoke, а `main` и production не изменяются автоматически.

## 15. Фаза 12 — cleanup, retention и восстановление

- [ ] Workflow-контейнер удаляется после загрузки артефактов.
- [ ] Удаляются только контейнеры с проверенными Self-Development labels.
- [ ] Cache сохраняется отдельно.
- [ ] Worktree после успешного merge удаляется.
- [ ] Rejected worktree хранится 7 дней.
- [ ] Failed worktree хранится 3 дня.
- [ ] Ветка с непринятыми commits не удаляется без решения владельца.
- [ ] Audit и итоговые артефакты хранятся согласно retention policy организации.
- [ ] После crash provider сверяет локальные containers/worktrees с backend leases.
- [ ] Orphan containers останавливаются только после reconciliation.

## 16. Фаза 13 — контролируемое самоулучшение

- [ ] Сохранять outcome каждого development run.
- [ ] Связывать outcome с CEO plan, agents, models, fallbacks, revisions, tests и approval decision.
- [ ] Рассчитывать качество планирования и назначения агентов.
- [ ] Создавать improvement proposal для routing, prompts, team composition и QA rules.
- [ ] Не применять proposal автоматически.
- [ ] После approval создавать новую версию правила.
- [ ] Сравнивать outcomes новой и предыдущей версии.
- [ ] Поддержать rollback правила.
- [ ] Никогда не разрешать self-improvement самостоятельно менять production-код, RLS, secrets или approval policy.

## 17. Тестовая матрица

### Provider

- [ ] Valid registration.
- [ ] Invalid/revoked token.
- [ ] Heartbeat timeout → Offline.
- [ ] Graceful draining.
- [ ] Restart во время active run.
- [ ] Mac выключен → waiting_for_provider.

### Queue и lease

- [ ] Два lease-запроса не получают один job.
- [ ] Expired lease восстанавливается.
- [ ] Duplicate completion идемпотентен.
- [ ] Несовместимый provider не получает job.

### Docker

- [ ] Контейнер не privileged.
- [ ] Нет Docker socket внутри workflow.
- [ ] Нет доступа за пределы worktree.
- [ ] CPU/RAM/time limits работают.
- [ ] Cleanup не удаляет пользовательские контейнеры.

### Git/IDE

- [ ] Selfdev worktree не меняет основной workspace.
- [ ] Ручные незакоммиченные изменения не попадают в run.
- [ ] Ручной commit в worktree включается в diff.
- [ ] Конфликт с обновлённым `main` блокирует merge.
- [ ] Force push невозможен.

### Agents

- [ ] CEO создаёт departments и dependencies.
- [ ] Lead создаёт субагентов.
- [ ] HR назначает reserve agent.
- [ ] HR создаёт temporary agent.
- [ ] Temporary agent архивируется с сохранением истории.

### Models

- [ ] 429 вызывает fallback.
- [ ] Retry-After соблюдается.
- [ ] 401/403 останавливает цепочку.
- [ ] Весь pool недоступен → waiting_for_model.
- [ ] Fallback не создаёт duplicate artifact.

### QA и approval

- [ ] Typecheck failure → revision.
- [ ] Migration RLS failure → revision.
- [ ] Scope violation → controller review.
- [ ] Push без approval запрещён.
- [ ] Preview smoke failure → revision.
- [ ] Production action без approval запрещён.

### Multi-tenant security

- [ ] Организация A не видит providers/runs/artifacts B.
- [ ] Пользователь не может lease job через Data API.
- [ ] Signed artifact URL ограничен временем.
- [ ] Provider token не появляется в логах.

## 18. Этапы выпуска

### Release A — Provider MVP

- [ ] Provider registration и heartbeat.
- [ ] Lease одной тестовой задачи.
- [ ] Docker workspace container.
- [ ] Worktree isolation.
- [ ] Возврат logs/diff/test result.
- [ ] Без автоматического push.

### Release B — Agent Development

- [ ] CEO/Lead/Agent assignments.
- [ ] HR temporary agents.
- [ ] Command broker и file leases.
- [ ] NVIDIA fallback.
- [ ] Controller review и QA.

### Release C — UI и Hybrid Mode

- [ ] Provider status.
- [ ] Иерархия агентов.
- [ ] Manual/Self-Development/Hybrid.
- [ ] Open worktree in IDE.
- [ ] Diff, artifacts и approvals.

### Release D — Controlled Delivery

- [ ] Approved push.
- [ ] Vercel Preview.
- [ ] Smoke verification.
- [ ] Rollback.
- [ ] Controlled improvement proposals.

## 19. Действия владельца

- [ ] Запустить Docker Desktop.
- [ ] Создать отдельный `SELFDEV_PROVIDER_TOKEN`.
- [ ] Добавить его hash/registration через защищённую backend-операцию.
- [ ] Создать `.env.selfdev` локально по шаблону.
- [ ] Подтвердить абсолютный путь репозитория.
- [ ] При необходимости создать ограниченный GitHub token для push selfdev-веток.
- [ ] Не передавать production Supabase/Vercel/Render secrets workflow-контейнерам.
- [ ] Запустить Compose profile `selfdev`.
- [ ] Проверить статус Provider Online в CRM.
- [ ] Подтверждать push, Preview, migration и production отдельно.

## 20. Финальный release gate

Self-Development Mode считается рабочим только после следующего сценария:

1. Docker Desktop и `selfdev-provider` запущены.
2. Provider отображается Online в CRM.
3. Владелец продолжает ручную работу в основной папке через IDE.
4. Через CRM создаётся задача «Добавить историю NVIDIA fallback в карточку агента».
5. CEO создаёт план и назначает Developer Lead.
6. Lead создаёт frontend, backend и QA assignments.
7. HR назначает постоянного или создаёт временного агента.
8. Provider забирает job и создаёт selfdev-ветку/worktree.
9. Запускается непривилегированный workflow container.
10. Агенты меняют только разрешённые paths.
11. Искусственный 429 переключает NVIDIA-модель без дубля.
12. QA выполняет typecheck, lint, build, backend tests и E2E.
13. Основной IDE workspace остаётся неизменным.
14. В CRM видны CEO, leads, agents, provider, models, fallbacks, progress и events.
15. Владелец открывает worktree в IDE и может продолжить работу вручную.
16. Работа возвращается агентам либо отправляется на approval.
17. Без approval push невозможен.
18. После approval selfdev-ветка отправляется в GitHub.
19. Создаётся Vercel Preview и проходит smoke test.
20. Контейнер удаляется, audit/artifacts сохраняются, временный агент освобождается.

После прохождения release gate ORBIT CRM поддерживает одновременно Manual Development и полноценный контролируемый Self-Development через локальный Docker Provider.
