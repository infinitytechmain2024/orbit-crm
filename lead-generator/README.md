# 🚀 Orbit Leads Prospector

AI-система автоматического поиска потенциальных клиентов для Orbit CRM.

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    Orbit CRM (Frontend)                         │
│  /lead-search — UI для запуска поиска и просмотра результатов   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API
┌──────────────────────────▼──────────────────────────────────────┐
│              Leads Prospector API (FastAPI)                     │
│  POST /api/search — запуск поиска                               │
│  GET  /api/search/{id} — статус + результаты задачи            │
│  GET  /api/sessions — список сохранённых поисков               │
│  POST /api/sessions — сохранить результаты                      │
│  GET  /api/sessions/{id} — загрузить результаты                 │
└──────┬───────────────────┬──────────────────────────────────────┘
       │                   │
       ▼                   ▼
┌──────────────┐   ┌──────────────────────────────────────────┐
│  Llama 3.2   │   │           Supabase                        │
│  (Ollama)    │   │  lead_clients + search_sessions tables     │
│  localhost   │   └───────────────────────────────────────────┘
│  :11434      │
└──────────────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│         Google Maps + OpenManus (Playwright)      │
│  Поиск бизнесов → парсинг контактов → валидация  │
└──────────────────────────────────────────────────┘
```

## Быстрый старт

### 1. Установка Ollama + Llama 3.2

```bash
# Установить Ollama (macOS)
brew install ollama

# Запустить Ollama
ollama serve

# Скачать Llama 3.2
ollama pull llama3.2
```

### 2. Настройка переменных окружения

```bash
cd leads-prospector
cp .env.example .env
# Отредактировать .env — ввести Supabase URL, service role key и organization ID
```

### 3. Запуск

```bash
# Сделать скрипт исполняемым
chmod +x start.sh

# Запуск (dev mode с hot-reload)
./start.sh dev

# Или prod mode
./start.sh prod
```

### 4. Использование

1. Откройте Orbit CRM → раздел «AI Поиск лидов»
2. Настройте параметры поиска (отрасль, локация, лимит)
3. Нажмите «Find Leads»
4. Следите за прогрессом (0→100%) в реальном времени
5. Просмотрите таблицу результатов и сохраните в Supabase

## API Endpoints

| Метод  | Путь                      | Описание                          |
| ------ | ------------------------- | --------------------------------- |
| `GET`  | `/api/health`             | Health check                      |
| `GET`  | `/api/status`             | Статус системы (Ollama, Supabase) |
| `POST` | `/api/search`             | Запуск поиска лидов               |
| `GET`  | `/api/search/{job_id}`    | Статус + результаты задачи        |
| `GET`  | `/api/search`             | Список всех задач                 |
| `GET`  | `/api/reports`            | Список отчётов                    |
| `GET`  | `/api/reports/{filename}` | Чтение отчёта                     |
| `GET`  | `/api/sessions`           | Список сохранённых поисков        |
| `POST` | `/api/sessions`           | Сохранить результаты поиска       |
| `GET`  | `/api/sessions/{id}`      | Загрузить сохранённый поиск       |

## Настройка Supabase

### Структура таблиц

- **lead_clients** — сохранённые лиды (business_name, email, phone, website, etc.)
- **search_sessions** — сохранённые поисковые сессии (criteria, total_found, created_at)

### Конфигурация

В `.env`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DEFAULT_ORGANIZATION_ID=your-organization-id
```

## Структура Markdown-отчёта

Отчёт генерируется в `./reports/` и содержит:

```markdown
# 📊 Lead Generation Report

**Дата:** 09.08.2026 14:30
**Найдено лидов:** 15
**Средний ICP Score:** 7.2/10

## 🎯 Критерии поиска (ICP)

...

## 📈 Executive Summary

...

## 🔍 Детальный анализ лидов

### 1. Company Name

| Метрика   | Значение          |
| --------- | ----------------- |
| ICP Score | `8/10` ████████░░ |
| ...       |

## 🌍 Анализ рынка

...

## 💡 Рекомендации

...
```

## Фоновый запуск

```bash
# Запуск в фоне (macOS/Linux)
nohup ./start.sh prod > lead-generator.log 2>&1 &

# Или через systemd (Linux)
# Создать файл /etc/systemd/system/lead-generator.service
```

## Требования

- Python 3.10+
- Ollama с моделью Llama 3.2 (`ollama pull llama3.2`)
- Supabase проект (для хранения лидов и сессий)
- Playwright (для browser-based парсинга)
