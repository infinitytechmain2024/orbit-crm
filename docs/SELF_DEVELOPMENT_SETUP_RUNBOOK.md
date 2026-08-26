# ORBIT CRM Self-Development — пошаговая настройка Vercel, Render, Supabase и Docker

Дата проверки инструкций: 2026-08-25

Этот runbook настраивает первый вертикальный срез:

```text
Vercel CRM → Render FastAPI → Supabase → Local Docker Self-Development Provider
                              ↓
                     Render private OpenClaw
```

На текущем этапе локальный Provider регистрируется и отправляет heartbeat. Выполнение Git worktree и дочерних workflow-контейнеров включается следующей фазой; поэтому `SELFDEV_EXECUTION_ENABLED=false` является обязательным безопасным значением.

## 1. Что подготовить

Нужны аккаунты и доступы:

- GitHub repository ORBIT CRM;
- Vercel project ORBIT CRM;
- Render workspace с `orbit-crm-backend` и `orbit-openclaw-private`;
- Supabase project;
- Docker Desktop на локальном Mac.

Официальные справки:

- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Render Environment Variables](https://render.com/docs/configure-environment-variables)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render Private Services](https://render.com/docs/private-services)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase CLI setup](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase local workflow](https://supabase.com/docs/guides/local-development/cli-workflows)

## 2. Создать серверные токены

Откройте Terminal на Mac и выполните:

```bash
openssl rand -hex 32
```

Сохраните результат как `INTERNAL_API_TOKEN`.

Повторите команду:

```bash
openssl rand -hex 32
```

Сохраните второй, отличный результат как `SELFDEV_PROVIDER_TOKEN`.

Ещё раз:

```bash
openssl rand -hex 32
```

Сохраните третий результат как `OPENCLAW_WEBHOOK_TOKEN`.

Токены должны быть разными. Не отправляйте их в чат, не добавляйте в Git и не вставляйте в переменные с префиксом `VITE_`.

## 3. Supabase

### 3.1 Найти Project Ref и URL

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard).
2. Выберите проект ORBIT CRM.
3. Посмотрите URL браузера:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>
```

Для текущего проекта ожидается:

```text
qavfajsflzbefgegkwjt
```

4. Откройте Project → Connect или Settings → API Keys.
5. Скопируйте Project URL:

```text
https://qavfajsflzbefgegkwjt.supabase.co
```

### 3.2 Получить ключи

Для frontend:

1. Settings → API Keys.
2. Скопируйте `Publishable key`, начинающийся с `sb_publishable_`.
3. Он используется как `VITE_SUPABASE_PUBLISHABLE_KEY`.

Для текущего backend:

1. Settings → API Keys → Legacy API Keys.
2. Найдите `service_role`.
3. Нажмите Reveal/Copy.
4. Используйте его только как `SUPABASE_SERVICE_ROLE_KEY` на Render.

Важно: текущий backend отправляет этот ключ и в `apikey`, и в Bearer Authorization. До отдельной миграции backend-аутентификации используйте legacy `service_role`, а не публикуемый ключ. Никогда не добавляйте его в Vercel `VITE_*` или локальный workflow-контейнер.

### 3.3 Подключить Supabase CLI

Перейдите в репозиторий:

```bash
cd '/Users/dmytrolishchyna/Desktop/ORBIT CRM'
```

Проверьте закреплённую версию CLI:

```bash
npx supabase@2.113.0 --version
```

Войдите:

```bash
npx supabase@2.113.0 login
```

Откроется браузер. Если автоматический вход не сработал:

1. Откройте Supabase Dashboard → Account → Access Tokens.
2. Создайте Personal Access Token.
3. Безопасно запросите токен средствами Terminal — ввод не будет отображаться:

```bash
read -s 'SUPABASE_CLI_TOKEN?Вставьте Supabase access token: '
echo
```

4. Передайте токен CLI и сразу удалите его из текущей shell-сессии:

```bash
npx supabase@2.113.0 login --token "$SUPABASE_CLI_TOKEN"
unset SUPABASE_CLI_TOKEN
```

Флаг `--no-browser` только запрещает автоматическое открытие браузера и сам по себе не создаёт prompt для access token.

Свяжите репозиторий с проектом:

```bash
npx supabase@2.113.0 link --project-ref qavfajsflzbefgegkwjt
```

Если CLI запросит database password, возьмите его в Supabase Dashboard → Project Settings → Database. Если пароль утерян, сначала сбросьте его в Dashboard и сохраните в password manager.

### 3.4 Проверить миграции

```bash
npx supabase@2.113.0 migration list --linked
```

Активная цепочка миграций после синхронизации production-схемы:

```text
supabase/migrations/20260826090734_remote_baseline.sql
supabase/migrations/20260826091011_selfdev_provider.sql
```

Предыдущая историческая цепочка сохранена для аудита в
`supabase/migrations_archive_pre_baseline_20260826/` и не должна повторно
применяться через `db push`.

Сначала выполните только dry run:

```bash
npx supabase@2.113.0 db push --linked --dry-run
```

Проверьте список. Не применяйте старые отсутствующие пересекающиеся миграции вслепую. Если dry run показывает много исторических миграций, остановитесь и сначала восстановите migration history/repair migration.

Когда dry run показывает только ожидаемые и проверенные миграции:

```bash
npx supabase@2.113.0 db push --linked
```

Никогда не выполняйте для production:

```text
supabase db reset --linked
```

### 3.5 Проверить таблицы

Откройте Supabase Dashboard → SQL Editor и выполните read-only запрос:

```sql
select to_regclass('public.development_providers') as providers,
       to_regclass('public.development_runs') as runs,
       to_regclass('public.development_run_events') as events,
       to_regprocedure('public.claim_selfdev_development_run(uuid,integer)') as claim_rpc;
```

Все четыре результата должны быть не `null`.

### 3.6 Найти Organization ID

В SQL Editor:

```sql
select id, name, created_at
from public.organizations
order by created_at;
```

Скопируйте UUID нужной организации. Он понадобится как:

```text
SELFDEV_ORGANIZATION_ID
```

### 3.7 Auth security

1. Откройте Authentication → URL Configuration.
2. Укажите production Site URL.
3. Добавьте Vercel Preview/Production callback URLs.
4. Откройте Authentication → Password Security.
5. Установите минимальную длину пароля не менее 8.
6. Если проект на Pro plan или выше, включите leaked-password protection.

## 4. Render

### 4.1 Настроить существующий объединённый Render-сервис

Backend и OpenClaw запускаются в одном Docker Web Service:

```text
Render orbit-crm-backend
├── FastAPI — публичный `$PORT`
└── OpenClaw — внутренний `127.0.0.1:18789`
```

Новый Blueprint и отдельный OpenClaw service не нужны:

1. Откройте [Render Dashboard](https://dashboard.render.com/).
2. Откройте существующий backend service.
3. В Settings проверьте подключённый GitHub repository и branch `main`.
4. Выберите Runtime `Docker`.
5. Укажите Dockerfile Path `./backend/Dockerfile.combined`.
6. Укажите Docker Build Context Directory `.`.
7. Укажите Health Check Path `/api/health`.
8. В Environment вручную добавьте переменные из раздела 4.2.
9. После появления кода в GitHub выберите Manual Deploy → Clear build cache & deploy.

`render.yaml` служит воспроизводимой конфигурацией, но не добавляет `sync: false`
секреты в уже существующий сервис автоматически. Их нужно добавить вручную через
Environment.

Старый отдельный `openclaw-ohki` после успешной проверки combined service можно
остановить, чтобы не платить за два экземпляра. До успешного smoke test не удаляйте его.

### 4.2 Backend environment variables

Откройте Render → `orbit-crm-backend` → Environment.

Добавьте:

```text
SUPABASE_URL=https://qavfajsflzbefgegkwjt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<legacy service_role из Supabase>
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
EXPECTED_SUPABASE_PROJECT_REF=qavfajsflzbefgegkwjt

INTERNAL_API_TOKEN=<первый openssl token>
SELFDEV_PROVIDER_TOKEN=<второй openssl token>
SELFDEV_PROVIDER_LEASE_SECONDS=90

NVIDIA_API_KEY=<ключ NVIDIA API Catalog>
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
GEMINI_API_KEY=<существующий ключ>
GROQ_API_KEY=<существующий ключ>

OPENCLAW_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<существующий gateway token>
OPENCLAW_WEBHOOK_TOKEN=<третий openssl token>
OPENCLAW_REQUEST_TIMEOUT=120
OPENCLAW_DAILY_ACTION_LIMIT=100
OPENCLAW_MAX_CONTEXT_RECORDS=20
```

`OPENCLAW_URL` должен оставаться ровно `http://127.0.0.1:18789`: это loopback
внутри Render-контейнера, а не ваш Mac. `OPENCLAW_DEFAULT_MODEL` и `NVIDIA_MODEL`
не обязательны для будущего мультишлюза.

Как получить NVIDIA key:

1. Войдите в NVIDIA API Catalog/Build.
2. Выберите поддерживаемую модель.
3. Нажмите Get API Key/Generate Key.
4. Скопируйте ключ в password manager.
5. Добавьте его в Render как `NVIDIA_API_KEY`.
6. Не добавляйте ключ во frontend.

После изменения Environment нажмите Save Changes. Render создаст новый deploy.

### 4.3 Как запускается внутренний OpenClaw

`backend.combined_supervisor` сначала запускает OpenClaw на loopback, ждёт успешный
`/healthz`, а затем запускает Uvicorn. Если любой критический процесс завершается,
контейнер останавливается, и Render перезапускает весь Web Service.

### 4.4 Проверить deploy

Откройте backend → Logs и найдите строку успешного запуска Uvicorn.

Скопируйте публичный backend URL из Render service page. Он выглядит как:

```text
https://orbit-crm-backend.onrender.com
```

Проверьте:

```bash
curl -i https://orbit-crm-backend.onrender.com/api/health
```

Ожидается `HTTP 200` и JSON со `status: ok`.

Проверьте, что provider API закрыт:

```bash
curl -i -X POST https://orbit-crm-backend.onrender.com/api/selfdev/providers/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"provider_id":"00000000-0000-0000-0000-000000000000"}'
```

Ожидается `401`.

## 5. Vercel

### 5.1 Какие переменные нужны

Откройте Vercel → ORBIT CRM project → Settings → Environment Variables.

Добавьте для Preview и Production:

```text
VITE_SUPABASE_URL=https://qavfajsflzbefgegkwjt.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_URL=https://qavfajsflzbefgegkwjt.supabase.co
SUPABASE_PUBLISHABLE_KEY=<тот же sb_publishable_...>

AI_WORKFLOW_BACKEND_URL=https://orbit-crm-backend.onrender.com
RENDER_BACKEND_URL=https://orbit-crm-backend.onrender.com
INTERNAL_API_TOKEN=<тот же первый token, что на Render backend>
```

Не добавляйте в Vercel:

```text
SUPABASE_SERVICE_ROLE_KEY
SELFDEV_PROVIDER_TOKEN
OPENCLAW_GATEWAY_TOKEN
```

`SELFDEV_PROVIDER_TOKEN` нужен только Render backend и локальному Docker Provider.

### 5.2 Настроить через CLI

Из репозитория:

```bash
cd '/Users/dmytrolishchyna/Desktop/ORBIT CRM'
npx vercel@latest login
npx vercel@latest link
```

Проверить текущие переменные:

```bash
npx vercel@latest env ls
```

Добавлять значения безопаснее интерактивно, чтобы секрет не попал в shell history:

```bash
npx vercel@latest env add VITE_SUPABASE_URL preview
npx vercel@latest env add VITE_SUPABASE_URL production
npx vercel@latest env add VITE_SUPABASE_PUBLISHABLE_KEY preview
npx vercel@latest env add VITE_SUPABASE_PUBLISHABLE_KEY production
npx vercel@latest env add SUPABASE_URL preview
npx vercel@latest env add SUPABASE_URL production
npx vercel@latest env add SUPABASE_PUBLISHABLE_KEY preview
npx vercel@latest env add SUPABASE_PUBLISHABLE_KEY production
npx vercel@latest env add AI_WORKFLOW_BACKEND_URL preview
npx vercel@latest env add AI_WORKFLOW_BACKEND_URL production
npx vercel@latest env add RENDER_BACKEND_URL preview
npx vercel@latest env add RENDER_BACKEND_URL production
npx vercel@latest env add INTERNAL_API_TOKEN preview
npx vercel@latest env add INTERNAL_API_TOKEN production
```

После добавления создайте Preview:

```bash
npx vercel@latest deploy
```

Production пока не запускайте. Команда production выглядит как `vercel deploy --prod`, но использовать её следует только после полного release gate.

Для локального воспроизведения Vercel Preview env:

```bash
npx vercel@latest pull --environment=preview
```

Vercel сохраняет загруженные настройки в `.vercel/`, который уже исключён из Git.

## 6. Локальный Docker Provider

### 6.1 Проверить Docker

Запустите Docker Desktop, затем:

```bash
docker version
docker compose version
docker info >/dev/null && echo 'Docker работает'
```

### 6.2 Создать локальный env

```bash
cd '/Users/dmytrolishchyna/Desktop/ORBIT CRM'
cp .env.selfdev.example .env.selfdev
```

Откройте файл только локально:

```bash
open -a TextEdit .env.selfdev
```

Заполните:

```text
SELFDEV_BACKEND_URL=https://orbit-crm-backend.onrender.com
SELFDEV_PROVIDER_TOKEN=<второй token, совпадает с Render backend>
SELFDEV_PROVIDER_NAME=dmytro-mac-docker
SELFDEV_ORGANIZATION_ID=<UUID из Supabase organizations>
SELFDEV_HEARTBEAT_SECONDS=15
SELFDEV_EXECUTION_ENABLED=false
```

Проверьте, что файл игнорируется Git:

```bash
git check-ignore -v .env.selfdev
```

### 6.3 Собрать Provider

```bash
docker compose --profile selfdev build selfdev-provider
```

### 6.4 Запустить

```bash
docker compose --profile selfdev up -d selfdev-provider
```

Проверить:

```bash
docker compose ps selfdev-provider
docker compose logs --tail=100 selfdev-provider
```

Ожидаемая строка:

```text
provider_registered provider_id=<uuid>
```

### 6.5 Проверить heartbeat в Supabase

SQL Editor:

```sql
select id, name, platform, architecture, status, last_heartbeat_at, metadata
from public.development_providers
order by updated_at desc;
```

Ожидается `status = available`, а `last_heartbeat_at` обновляется примерно каждые 15 секунд.

### 6.6 Остановить Provider

```bash
docker compose stop selfdev-provider
```

Запустить снова:

```bash
docker compose --profile selfdev up -d selfdev-provider
```

Полностью удалить только Provider-контейнер:

```bash
docker compose rm -f selfdev-provider
```

Эта команда не удаляет OpenClaw, backend или пользовательские Docker volumes.

## 7. Локальный backend для первичной проверки

Если Render ещё не обновлён, Provider можно проверить через локальный backend.

В корневом `.env` должны быть:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEY
EXPECTED_SUPABASE_PROJECT_REF
SELFDEV_PROVIDER_TOKEN
```

Запустите backend:

```bash
cd '/Users/dmytrolishchyna/Desktop/ORBIT CRM'
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

В `.env.selfdev` оставьте:

```text
SELFDEV_BACKEND_URL=http://host.docker.internal:8000
```

Затем в другом Terminal:

```bash
docker compose --profile selfdev up -d --build selfdev-provider
docker compose logs -f selfdev-provider
```

## 8. Проверочный checklist

- [x] Supabase migration dry run проверен.
- [x] Provider migration применена.
- [ ] Таблицы и claim RPC существуют.
- [ ] Render backend содержит `SELFDEV_PROVIDER_TOKEN`.
- [ ] Render backend `/api/health` отвечает 200.
- [ ] Provider endpoint без token отвечает 401.
- [ ] Vercel направлен на публичный Render backend.
- [ ] `.env.selfdev` не отслеживается Git.
- [ ] Docker Provider успешно собирается.
- [ ] Provider регистрируется.
- [ ] Heartbeat обновляется в Supabase.
- [ ] `SELFDEV_EXECUTION_ENABLED=false` до реализации worktree executor.

## 9. Частые ошибки

### `401 Invalid or missing provider token`

- Сравните `SELFDEV_PROVIDER_TOKEN` в Render backend и `.env.selfdev`.
- После изменения Render env дождитесь нового deploy.
- Пересоздайте Provider:

```bash
docker compose --profile selfdev up -d --force-recreate selfdev-provider
```

### `503 Self-development provider token is not configured`

Добавьте `SELFDEV_PROVIDER_TOKEN` в Render backend Environment и redeploy.

### `Database request failed: relation development_providers does not exist`

Миграция не применена. Проверьте:

```bash
npx supabase@2.113.0 migration list --linked
npx supabase@2.113.0 db push --linked --dry-run
```

### `Organization has no member`

Указан неверный `SELFDEV_ORGANIZATION_ID` либо в организации нет membership. Проверьте SQL:

```sql
select o.id, o.name, om.user_id, om.role
from public.organizations o
left join public.organization_members om on om.organization_id = o.id;
```

### Provider не соединяется с локальным backend

Проверьте:

```bash
curl -i http://127.0.0.1:8000/api/health
docker run --rm curlimages/curl:latest \
  http://host.docker.internal:8000/api/health
```

### Provider зарегистрирован, но задачи не выполняются

В первом P0-срезе это ожидаемо: `SELFDEV_EXECUTION_ENABLED=false`. Следующий этап добавляет Git worktree manager, command broker и дочерние workflow-контейнеры.
