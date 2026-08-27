# Orbit CRM — production readiness

Дата проверки: 2026-08-25  
Решение: **NOT READY (не готово к production)**

## Проверенные критерии

| Критерий                                                        | Статус       | Фактическое доказательство                                                                                                                                                         |
| --------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend build (сборка клиентской части)                        | PASS         | Локальная и Vercel Preview сборки завершены успешно                                                                                                                                |
| Backend tests (серверные тесты)                                 | PASS         | 24/24 unit/integration tests (модульных/интеграционных теста)                                                                                                                      |
| Browser smoke (браузерная проверка)                             | PARTIAL      | 6/6 Playwright tests; проверяют загрузку/login shell, но не рабочий сценарий с реальными данными                                                                                   |
| Vercel Preview                                                  | PASS         | Frontend `200`, анонимный backend proxy (серверный прокси) `401`                                                                                                                   |
| RLS двух организаций                                            | PASS/PARTIAL | Транзакционно подтверждена изоляция project/update/Storage; в production существует только один Auth user (пользователь), поэтому сценарий двух реальных пользователей не проверен |
| Webhook protection/idempotency (защита/идемпотентность вебхука) | PASS         | Backend security tests подтверждают invalid token rejection и stable idempotency key (стабильный ключ идемпотентности)                                                             |
| Calendar queue/Cron (очередь/планировщик календаря)             | PASS         | `orbit-calendar-reminders` активен каждую минуту, backlog (накопление) равен 0                                                                                                     |
| OpenClaw health/task execution                                  | FAIL         | Vercel proxy получает `404 Cannot GET`; сквозное выполнение задания не подтверждено                                                                                                |
| Workflow durable queue (надёжная очередь процессов)             | FAIL, P0     | В production отсутствуют `public.ai_tasks`, `public.workflow_runs` и `public.workflow_jobs`                                                                                        |
| Backup/rollback (резервная копия/откат)                         | PARTIAL      | Процедура отката документирована; фактическая политика backup/PITR (восстановления на момент времени) не подтверждена                                                              |
| Alerts (оповещения)                                             | FAIL         | Нет подтверждённых alert rules (правил оповещения) для 5xx, authorization failures и queue backlog                                                                                 |
| Security Advisor (проверка безопасности)                        | PARTIAL      | RLS-проблем высокого уровня нет; leaked-password protection (проверка скомпрометированных паролей) отключена                                                                       |

## Фактические production-данные

- Auth users (пользователи): 1.
- Organizations (организации): 1.
- Memberships (членства): 1.
- Storage buckets (файловые бакеты): 1 — закрытый `task-files`, лимит 6 MiB.
- OpenClaw active backlog (активная очередь): 0.
- Calendar reminder backlog (очередь напоминаний): 0.

Нулевой backlog не является доказательством работы OpenClaw: в системе нет подтверждённого успешно выполненного end-to-end task (сквозного задания).

## P0 release blockers (блокеры выпуска)

1. Подготовить repair migration (исправляющую миграцию) для отсутствующих `ai_tasks`, `workflow_runs`, `workflow_jobs` и связанных RPC (серверных функций). Не применять старую миграцию целиком вслепую: более поздняя CRM foundation (основа CRM) уже частично пересекается с ней.
2. Исправить `AI_WORKFLOW_BACKEND_URL` на Vercel: он должен указывать на публичный FastAPI Render service, а не OpenClaw gateway.
3. Развернуть/проверить Render backend и private OpenClaw service, затем выполнить реальный OpenClaw health + task + webhook callback (обратный вызов).
4. Выполнить авторизованный CRM journey (пользовательский сценарий): login → client/lead → deal → task → calendar → history.
5. Настроить и проверить alerts для 5xx, 401/403 spikes (всплесков), backlog и недоступности OpenClaw.

## Release gate

Перед promotion (переводом) Preview в production выполнить:

```bash
npm run lint
npm run build
npm run test:e2e
.venv/bin/python -m unittest discover -s backend/tests -v
```

Затем выполнить `scripts/check-production-schema.sql` через Supabase SQL Editor/MCP в read-only проверке (проверке только чтением) и `scripts/smoke-production.sh` для Vercel/Render URLs. Любая ошибка блокирует выпуск.

Production-домен нельзя переключать, пока все P0 не закрыты и этот документ не изменён на `READY` с приложенными результатами проверок.

## Дальнейшее развитие после запуска

- P2: вынести workflow worker из FastAPI lifespan (жизненного цикла) в отдельный Render background worker (фоновый обработчик), оставив Postgres lease/locking (аренду/блокировки) единственным механизмом координации.
- P2: добавить authenticated E2E (авторизованный сквозной тест) с отдельными тестовыми организациями.
- P2: устранить подтверждённые missing foreign-key indexes (отсутствующие индексы внешних ключей) после анализа реальных query plans (планов запросов).
- P3: измерять качество рекомендаций по `ai_outcomes`, но не разрешать автоматическое изменение правил или кода.
