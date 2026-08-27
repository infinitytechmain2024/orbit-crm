# Orbit CRM — staging и production

## Утверждённая схема размещения

| Компонент                                                    | Платформа                                                                    | Причина                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| TanStack Start frontend и server routes (серверные маршруты) | Vercel                                                                       | Сборка Nitro формирует нативный `.vercel/output`                                       |
| FastAPI и workflow worker (обработчик процессов)             | Render, always-on web service (постоянно работающий веб-сервис)              | Нужен долгоживущий Python-процесс                                                      |
| OpenClaw gateway (шлюз)                                      | Render private service (закрытый сервис) + persistent disk (постоянный диск) | Нужны Node.js, системные инструменты и файловое состояние                              |
| Auth/Postgres/Storage                                        | Supabase                                                                     | Существующий слой данных и RLS (изоляция строк)                                        |
| DNS/WAF/CDN                                                  | Cloudflare, опционально                                                      | Защита домена; вычислительные сервисы не переносить на Workers без отдельной адаптации |

Корневой `render.yaml` — единственный актуальный Blueprint (описание инфраструктуры). `services/openclaw/render.yaml` оставлен только как legacy rollback (старый вариант для отката) публичного gateway и не должен применяться для новой среды.

## Обязательные переменные

Значения нельзя сохранять в Git. Проверять нужно наличие и соответствие, а не вывод секретов.

### Vercel

```dotenv
VITE_SUPABASE_URL=URL_проекта_Supabase
VITE_SUPABASE_PUBLISHABLE_KEY=публичный_ключ_Supabase
SUPABASE_URL=URL_проекта_Supabase_для_server_routes
SUPABASE_PUBLISHABLE_KEY=публичный_ключ_Supabase_для_server_routes
AI_WORKFLOW_BACKEND_URL=https_URL_Render_backend
INTERNAL_API_TOKEN=тот_же_случайный_секрет_что_на_Render_backend
```

### Render backend

Использовать список из корневого `render.yaml`. Критические пары: `INTERNAL_API_TOKEN` должен совпадать с Vercel, а `OPENCLAW_GATEWAY_TOKEN` должен поступать из private service (закрытого сервиса). `CORS_ORIGINS` должен содержать только production/preview origins (адреса), если браузер обращается к backend напрямую.

### Render OpenClaw

`OPENCLAW_GATEWAY_TOKEN` генерируется Blueprint, state (состояние) хранится на диске `/home/node/.openclaw`. Ключ модели (`NVIDIA_API_KEY`) вводится только в Render.

## Release gate (условия выпуска)

1. Локально пройти `npm run lint`, `npm run build`, backend tests (серверные тесты) и `scripts/smoke-production.sh` для уже доступных URL.
2. Развернуть Vercel Preview (тестовую версию), не production.
3. В Preview проверить login, организацию, clients, leads, deals, tasks, calendar и деградацию при отключённом OpenClaw.
4. Проверить через авторизованную сессию `/api/backend/api/health` и `/api/openclaw/health`.
5. На Render подтвердить healthy deploy (успешное развёртывание), private networking (закрытую сеть), диск OpenClaw и отсутствие рестартов worker.
6. Получить отдельное подтверждение бюджета перед переводом backend с Free на Starter.
7. Только после этого назначать production deployment (рабочее развёртывание) и менять DNS.

## Deploy и rollback (развёртывание и откат)

Preview из корня проекта:

```bash
npx vercel@latest deploy
```

После проверок promotion (перевод проверенной версии в production) выполнять через Vercel Dashboard, сохранив предыдущий production deployment. При ошибке немедленно вернуть предыдущий deployment через **Deployments → предыдущая версия → Promote to Production**. На Render использовать **Rollback** на последнюю исправную версию; миграции базы данных должны иметь отдельную forward-fix (исправляющую миграцию), а не удаление данных.

DNS не переключать, пока Preview и Render staging не прошли полный smoke test (быструю проверку). TTL (время жизни DNS-записи) снижать заранее; старые Vercel endpoints (адреса) сохранять до завершения периода наблюдения.

## Наблюдение после выпуска

- Vercel: доля `5xx`, latency (задержка) server routes, ошибки proxy.
- Render backend: `/api/health`, рестарты, очередь workflow, CPU/RAM.
- OpenClaw: проверка `/healthz` через backend, использование диска, ошибки модели.
- Supabase: Auth failures (ошибки входа), медленные запросы, Storage/RLS denials (отказы политик доступа).
- Корреляция инцидента выполняется по `X-Request-ID`; секреты и содержимое сообщений в лог не записываются.
