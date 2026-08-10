# 🚀 Orbit Lead Generator

AI-система автоматического поиска потенциальных клиентов для Orbit CRM.

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    Orbit CRM (Frontend)                         │
│  /lead-search — UI для запуска поиска и просмотра отчётов      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API
┌──────────────────────────▼──────────────────────────────────────┐
│              Lead Generator API (FastAPI)                       │
│  POST /api/search — запуск поиска                              │
│  GET  /api/search/{id} — статус задачи                         │
│  GET  /api/reports — список отчётов                            │
│  POST /api/notion/sync — экспорт в Notion                      │
└──────┬───────────────────┬──────────────────────────────────────┘
       │                   │
       ▼                   ▼
┌──────────────┐   ┌──────────────────────────────────────────┐
│  Llama 3.2   │   │           Markdown Reports               │
│  (Ollama)    │   │  ./reports/leads_report_YYYY-MM-DD.md    │
│  localhost   │   └───────────────────┬──────────────────────┘
│  :11434      │                       │
└──────────────┘                       ▼
                              ┌─────────────────┐
                              │   Notion API    │
                              │  Leads Database │
                              └─────────────────┘
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
cd lead-generator
cp .env.example .env
# Отредактировать .env — ввести NOTION_API_KEY и NOTION_DATABASE_ID
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
2. Настройте параметры поиска (отрасль, локация, ключевые слова)
3. Нажмите «Начать поиск»
4. Дождитесь завершения (AI-агент проанализирует источники)
5. Просмотрите отчёт и экспортируйте в Notion

## API Endpoints

| Метод  | Путь                      | Описание                        |
| ------ | ------------------------- | ------------------------------- |
| `GET`  | `/api/health`             | Health check                    |
| `GET`  | `/api/status`             | Статус системы (Ollama, Notion) |
| `POST` | `/api/search`             | Запуск поиска лидов             |
| `GET`  | `/api/search/{job_id}`    | Статус задачи                   |
| `GET`  | `/api/search`             | Список всех задач               |
| `GET`  | `/api/reports`            | Список отчётов                  |
| `GET`  | `/api/reports/{filename}` | Чтение отчёта                   |
| `POST` | `/api/notion/sync`        | Синхронизация с Notion          |

## Настройка Notion

### Создание интеграции

1. Перейдите на https://www.notion.so/my-integrations
2. Нажмите «New integration»
3. Назовите её «Orbit Lead Generator»
4. Выберите workspace
5. Скопируйте «Internal Integration Secret»

### Создание базы данных

1. Создайте новую страницу в Notion
2. Добавьте таблицу (Table) с колонками:
   - **Name** (Title)
   - **Company** (Text)
   - **Industry** (Text)
   - **Location** (Text)
   - **Email** (Email)
   - **Phone** (Phone)
   - **Website** (URL)
   - **LinkedIn** (URL)
   - **ICP Score** (Number)
   - **Status** (Status: New, Contacted, Qualified, Converted, Rejected)
   - **Created At** (Date)
3. Подключите интеграцию к базе (Share → Invite → выберите интеграцию)
4. Скопируйте ID базы из URL: `https://notion.so/{database_id}?v=...`

### Конфигурация

В `.env`:

```
NOTION_API_KEY=ntn_xxxxxxxxxxxxx
NOTION_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
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
- Ollama с моделью Llama 3.2
- Notion API ключ (опционально)
- Playwright (для browser-based поиска)
