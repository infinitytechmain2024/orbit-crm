# Aura CRM

Роль: Ты — Frontend / UI/UX Разработчик (React / Next.js, Tailwind CSS, Lucide Icons, Framer Motion).
Задача: Сделать полностью рабочий, красивый и интерактивный клиентский прототип (Frontend-only) персональной CRM-системы. Бэкенд пока не нужен — все данные должны браться из локального состояния (state) или JSON-моков (mock data).

🛠 Требования к UI и функционалу:
Дизайн и Тема:

Современный, премиальный, минималистичный дизайн (Dashboard-first).

Тёмная тема по умолчанию (Dark Mode) с переключателем на светлую (Light Mode).

Удобный боковой сайдбар (Sidebar) с навигацией по разделам.

Главный дашборд (Dashboard):

Панель быстрого ввода задач/мыслей с кнопкой «Разобрать через ИИ» (имитация работы ИИ с красивыми анимациями загрузки).

Виджеты: краткие финансовые метрики, ближайшие задачи, последние письма.

Модуль Задач и Карта Проектов:

Переключение режимов: Канбан-доска (Kanban), Список (List) и Интерактивный граф/Карта связей проектов (можно использовать простую визуализацию узлов через Canvas/SVG или React Flow).

Возможность двигать карточки, менять статусы, открывать модальное окно с деталями задачи.

ИИ-Чат / Ассистент (AI Bar):

Выплывающая панель или плавающая кнопка чата.

Имитация ответов ИИ на тестовые запросы (например, «Создай задачу», «Покажи аналитику»).

Почтовый клиент (Email Hub):

Список тестовых писем, окно просмотра письма, кнопка «Превратить письмо в задачу» (при нажатии создает карточку в задачах).

Финансы:

Дашборд доходов/расходов с интерактивными графиками (Recharts / Chart.js).

Результат: Рабочий код фронтенда, где можно кликать по всем кнопкам, переключать табы, открывать модалки и менять темы.

⚡ Промпт №2: ТЗ для Supabase & Бэкенд-разработчика
Этот промпт пригодится, когда фронтенд будет готов и захочется привязать настоящую базу данных:

Роль: Ты — Senior Backend / Supabase Инженер.
Задача: Подключить готовый фронтенд CRM-системы к Supabase (PostgreSQL, Auth, Edge Functions) и настроить «Единую Память» (RAG) для ИИ.

🛠 Что нужно спроектировать и реализовать:
Архитектура базы данных (Supabase PostgreSQL):

Схема таблиц: projects, tasks, transactions, emails, ai_memories.

Настройка Row Level Security (RLS) для защиты данных.

Единая память и Векторный поиск (Vector DB / pgvector):

Включение расширения pgvector в Supabase.

Создание таблицы эмбеддингов для проектов, задач и писем.

Настройка автоматической генерации векторных контекстов при создании/обновлении записей.

Интеграция ИИ (Supabase Edge Functions / Node.js):

Написание функций для вызова OpenAI / Anthropic API.

Поиск по векторной базе знаний перед ответом ИИ (RAG).

Почта (Email Integration):

Настройка webhook / cron-задач для парсинга входящих писем (через Resend, Gmail API или IMAP-воркер).

Связка с Фронтендом:

Замена всех mock-данных во фронтенде на запросы к Supabase SDK (@supabase/supabase-js).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/58c53245-4925-4d19-aeaf-84fa90f9945e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
