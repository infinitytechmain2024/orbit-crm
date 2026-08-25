# Orbit CRM — запуск и эксплуатация

## Архитектура

- Web application (веб-приложение): React + TanStack Start, Vercel-compatible server runtime (серверная среда Vercel).
- CRM data plane (слой данных CRM): Supabase Postgres/Auth/Storage с RLS (изоляцией строк).
- Workflow backend (сервер рабочих процессов): FastAPI на Render.
- OpenClaw gateway (шлюз OpenClaw): отдельный private service (закрытый сервис) на Render.

CRM не зависит от доступности OpenClaw для чтения и изменения основных CRM-данных. При недоступном шлюзе AI-функции возвращают `502/503`, не блокируя CRM.

## Переменные окружения

Секреты нельзя добавлять с префиксом `VITE_`: такие значения доступны браузеру.

### Vercel

```dotenv
VITE_SUPABASE_URL=URL_проекта_Supabase
VITE_SUPABASE_PUBLISHABLE_KEY=публичный_publishable_key
SUPABASE_URL=тот_же_URL_для_server_routes
SUPABASE_PUBLISHABLE_KEY=публичный_publishable_key_для_проверки_session
AI_WORKFLOW_BACKEND_URL=https_URL_backend_Render
INTERNAL_API_TOKEN=общий_случайный_токен_Vercel_и_backend
AGENTMAIL_API_KEY=секретный_ключ_AgentMail
AGENTMAIL_INBOX=id_или_адрес_inbox
AGENTMAIL_WEBHOOK_SECRET=секрет_Svix_начинающийся_с_whsec
AGENTMAIL_ORGANIZATION_ID=uuid_организации_которой_принадлежит_inbox
NVIDIA_API_KEY=серверный_ключ_если_используются_Vercel_AI_routes
GROQ_API_KEY=серверный_ключ_если_используется_transcription
```

### Render backend

```dotenv
SUPABASE_URL=URL_проекта_qavfajsflzbefgegkwjt
SUPABASE_PUBLISHABLE_KEY=публичный_publishable_key
SUPABASE_SERVICE_ROLE_KEY=секретный_service_role_key
SUPABASE_JWKS_URL=JWKS_URL_проекта
INTERNAL_API_TOKEN=тот_же_токен_что_на_Vercel
OPENCLAW_URL=http_URL_private_OpenClaw_service
OPENCLAW_GATEWAY_TOKEN=токен_шлюза_OpenClaw
OPENCLAW_WEBHOOK_TOKEN=отдельный_токен_webhook
CORS_ORIGINS=["https://рабочий-домен","https://preview-домен"]
```

### Render OpenClaw

```dotenv
OPENCLAW_GATEWAY_TOKEN=тот_же_токен_что_в_backend
OPENCLAW_DEFAULT_MODEL=nvidia/nvidia/nemotron-3-ultra-550b-a55b
NVIDIA_API_KEY=ключ_провайдера_модели
GROQ_API_KEY=опциональный_fallback_ключ
```

## Локальный запуск

В корне проекта:

```bash
npm ci
npm run dev
```

В отдельном терминале, также в корне:

```bash
.venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

OpenClaw запускается из `services/openclaw` согласно его Dockerfile. Проверка backend: `GET /api/health`; проверка OpenClaw через backend: `GET /api/openclaw/health` с internal token (внутренним токеном).

Прямую проверку трёх контрактов gateway выполнять из среды с доступом к его private hostname (внутреннему имени):

```bash
.venv/bin/python backend/scripts/check_openclaw_gateway.py
```

Скрипт проверяет `/healthz`, `/v1/models` и `/v1/chat/completions`, но не выводит секретные токены.

Для существующего публичного `orbit-openclaw` Blueprint создаёт новый `orbit-openclaw-private`, потому что Render не позволяет менять тип уже созданного сервиса. Сначала проверить новый private service через backend, затем отдельно удалить старый public service (публичный сервис). Не удалять старый сервис до успешного smoke test (быстрой проверки).

## Проверки перед deploy (развёртыванием)

```bash
npm run lint
npm run build
.venv/bin/python -m unittest discover -s backend/tests -v
.venv/bin/python -m compileall -q -x '/(venv|venv314)/' backend
sh -n services/openclaw/render-entrypoint.sh
```

После preview deploy (тестового развёртывания) проверить: login, организацию, клиентов, лиды, задачи, календарь, записи, OpenClaw recommendation (рекомендацию), недоступность AI без влияния на CRM.

## Календарные напоминания

- Источник событий — `public.calendar_events`; время хранится как `timestamptz` в UTC и отображается в локальном часовом поясе браузера.
- Базовый канал — `in_app` (внутри CRM). Email/SMS не отправляются, пока отдельно не выбран и не настроен провайдер.
- `calendar_reminders` — durable queue (надёжная очередь), `calendar_reminder_deliveries` — журнал доставок.
- Cron job (планировщик) `orbit-calendar-reminders` вызывает обработчик раз в минуту.
- Unique constraint (уникальное ограничение) и блокировка `FOR UPDATE SKIP LOCKED` предотвращают повторную доставку при параллельной обработке.
- При переносе события напоминание сдвигается на тот же интервал; при отмене события очередь получает статус `cancelled`.

Проверка состояния без изменения данных:

```sql
select jobname, schedule, active from cron.job where jobname = 'orbit-calendar-reminders';
select status, count(*) from public.calendar_reminders group by status;
```

## AgentMail и коммуникации

- `AGENTMAIL_API_KEY` и webhook secret (секрет вебхука) разрешены только в Vercel server environment (серверном окружении), без префикса `VITE_`.
- Endpoint (конечная точка) входящих событий: `POST /api/mail/webhook`. AgentMail использует заголовки `svix-id`, `svix-timestamp`, `svix-signature`.
- Каждый исходящий запрос требует `confirmed=true`, проверенного membership (членства) организации и уникального idempotency key (ключа идемпотентности).
- История результата хранится в `communication_events`; текст письма в журнал не копируется.
- Повторный webhook с тем же `svix-id` возвращает успешный replay response (ответ повтора) и не создаёт вторую запись.

## Безопасное обучение

Результаты сохраняются в `ai_outcomes`; предложения — в `ai_improvement_proposals`. Значимое изменение knowledge base (базы знаний) применяет только owner/admin через backend. Применение создаёт запись в `company_knowledge_versions`; rollback (откат) создаёт новую версию и не удаляет историю. OpenClaw не получает права менять код, роли, финансовые условия или массово отправлять сообщения.

- Экран `/self-development` показывает повторяющийся сценарий только после трёх outcomes (результатов) с одинаковыми типом действия и исходом.
- Pattern (сценарий) содержит количество наблюдений, охват клиентов, среднюю оценку и идентификаторы доказательств. Он не изменяет правила автоматически.
- Любое proposal (предложение) попадает в `pending_review`. High/critical risk (высокий/критический риск) не имеет обходного автоматического пути.
- Решение owner/admin требует текстового основания. Каждая смена статуса записывается в `ai_improvement_proposal_events` с автором и снимком предложения.
- Knowledge proposal (предложение знания) после подтверждения создаёт новую неизменяемую версию. Template/business process (шаблон/бизнес-процесс) получает статус `approved`, но требует отдельной ручной реализации.
- Rollback (откат) не удаляет историю: он создаёт следующую версию с содержимым предыдущего правила.

Проверка контура:

```sql
select status, risk_level, count(*) from public.ai_improvement_proposals
group by status, risk_level;
select proposal_id, previous_status, new_status, actor_id, reason, created_at
from public.ai_improvement_proposal_events order by created_at desc limit 50;
```

## Память и база знаний

- Подтверждённые пользователем факты хранятся в `ai_user_memory` в границах пользователя и организации. OpenClaw получает только активные, неистёкшие факты текущего пользователя.
- Исправление факта требует причины. Предыдущее значение автоматически архивируется в `ai_user_memory_revisions` и доступно только владельцу факта; история не перезаписывается.
- `expires_at` задаёт срок действия временного факта. Истёкшая запись сохраняется для аудита, но исключается из контекста OpenClaw.
- Знания компании хранятся версионно в `company_knowledge_versions`. OpenClaw получает только текущую версию знаний своей организации.
- Изменение базы знаний через controlled learning (контролируемое обучение) требует подтверждения owner/admin; rollback (откат) создаёт новую версию.
- Клиенты и события календаря автоматически отражаются в knowledge graph (графе знаний), включая связи события с клиентом или задачей.

Проверка без изменения данных:

```sql
select count(*) from public.ai_user_memory where expires_at is null or expires_at > now();
select count(*) from public.ai_user_memory_revisions;
select entity_type, count(*) from public.graph_nodes group by entity_type;
select relation_type, count(*) from public.graph_relations group by relation_type;
```

## Известные внешние блокировки

- В Supabase Auth нужно включить leaked password protection (проверку утёкших паролей) в Dashboard.
- Production deploy (рабочее развёртывание) требует сверки значений Vercel/Render; значения на скриншотах скрыты и не подтверждают совпадение токенов.
- Docker image (образ Docker) OpenClaw полностью не собирался локально при недоступном Docker daemon (службе Docker).
- Основной домен переключать только после успешного preview smoke test (быстрой проверки).
