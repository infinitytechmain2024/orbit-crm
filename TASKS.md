# Orbit CRM — Дорожная карта / Технический чек-лист

> **Стек проекта:** TanStack Start + TanStack Router + Vite 8 + React 19 + Tailwind CSS v4 + shadcn/ui (new-york) + Bun  
> **Supabase:** Пока не интегрирован (mock-данные в `src/lib/crm-data.ts`, React Context в `src/lib/crm-store.tsx`)  
> **Текущие роуты:** `/` (Dashboard), `/tasks` (Kanban/List/Graph), `/mail` (Email Hub), `/finance` (Finance)

---

## Содержание

1. [Брендинг, Favicon и Метаданные](#1-брендинг-favicon-и-метаданные)
2. [Адаптивный Логотип и Шапка (Sidebar & Header)](#2-адаптивный-логотип-и-шапка)
3. [Маршрутизация и Главная страница](#3-маршрутизация-и-главная-страница)
4. [Объединение модулей «Заявки» и «Записи»](#4-объединение-модулей-заявки-и-записи)
5. [Интерактивный Календарь (Drag-and-Drop)](#5-интерактивный-календарь)
6. [Вкладка «Клиенты» и Сегментация](#6-вкладка-клиенты-и-сегментация)
7. [Retention & Напоминания (90 дней)](#7-retention--напоминания)

---

## 1. Брендинг, Favicon и Метаданные

### 1.1 Favicon & Browser Icon

**Цель:** Заменить стандартный Lovable/favicon на фирменный логотип Orbit CRM (атомная орбита).

#### Файлы для замены

| Файл                          | Текущее состояние | Действие                                |
| ----------------------------- | ----------------- | --------------------------------------- |
| `public/favicon.ico`          | Существует (ico)  | Заменить на новый логотип 32×32 / 16×16 |
| `public/apple-touch-icon.png` | **Отсутствует**   | Создать 180×180 PNG с логотипом         |
| `public/icon-192.png`         | **Отсутствует**   | Создать 192×192 PNG (для PWA/Android)   |
| `public/icon-512.png`         | **Отсутствует**   | Создать 512×512 PNG (для PWA/Android)   |
| `public/manifest.json`        | **Отсутствует**   | Создать веб-манифест                    |

#### Генерация иконок

1. Подготовить SVG-логотип на основе provided image (орбита без текста, только символ).
   - Сохранить как `public/logo-icon.svg` (чистый SVG).
2. Конвертировать SVG в:
   - `favicon.ico` (32×32, 16×16 multi-res) — через `sharp` CLI или онлайн-конвертер.
   - `apple-touch-icon.png` (180×180).
   - `icon-192.png`, `icon-512.png`.
3. Убедиться, что логотип читаем на тёмном фоне (проект по умолчанию dark mode).

#### Web Manifest (`public/manifest.json`)

```json
{
  "name": "Orbit CRM",
  "short_name": "Orbit",
  "description": "Персональная CRM-система для управления записями и клиентами",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0f1a",
  "theme_color": "#14b8a6",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

#### Ссылки в Root Layout

**Файл:** `src/routes/__root.tsx:86-98`

Текущий блок `links`:

```ts
links: [{ rel: "icon", href: "/favicon.ico", type: "image/x-icon" }];
```

Заменить на:

```ts
links: [
  { rel: "icon", href: "/favicon.ico", type: "image/x-icon", sizes: "32x32" },
  { rel: "icon", href: "/logo-icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
  { rel: "manifest", href: "/manifest.json" },
  { name: "theme-color", content: "#14b8a6" },
];
```

---

### 1.2 Meta Title & Description

**Цель:** Добавить `<title>` и meta description на корневой и дочерние роуты.

#### Root Layout (`src/routes/__root.tsx:79-85`)

Текущий `meta` массив:

```ts
meta: [
  { charSet: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { name: "author", content: "Orbit CRM" },
  { property: "og:type", content: "website" },
  { name: "twitter:card", content: "summary_large_image" },
];
```

Добавить:

```ts
meta: [
  { charSet: "utf-8" },
  { name: "viewport", content: "width=device-width, initial-scale=1" },
  { name: "author", content: "Orbit CRM" },
  { title: "Orbit CRM — Панель управления" },
  {
    name: "description",
    content: "Персональная CRM-система для управления записями, клиентами и финансами",
  },
  { property: "og:type", content: "website" },
  { property: "og:site_name", content: "Orbit CRM" },
  { name: "twitter:card", content: "summary_large_image" },
];
```

#### Per-Route Meta (каждый роут переопределяет title)

| Роут                | Файл                           | Title                          | Description                     |
| ------------------- | ------------------------------ | ------------------------------ | ------------------------------- |
| `/`                 | `src/routes/index.tsx:22-32`   | `Orbit CRM — Дашборд`          | Обзор задач, почты и финансов   |
| `/tasks`            | `src/routes/tasks.tsx:11-22`   | `Задачи и проекты — Orbit CRM` | Канбан, список и карта проектов |
| `/mail`             | `src/routes/mail.tsx:10-18`    | `Почта — Orbit CRM`            | Входящие и отправленные письма  |
| `/finance`          | `src/routes/finance.tsx:25-33` | `Финансы — Orbit CRM`          | Доходы, расходы и аналитика     |
| `/clients` (новый)  | Новый файл                     | `Клиенты — Orbit CRM`          | Управление базой клиентов       |
| `/calendar` (новый) | Новый файл                     | `Календарь — Orbit CRM`        | Расписание и записи             |
| `/book` (новый)     | Новый файл                     | `Запись на приём — Orbit CRM`  | Клиентская форма бронирования   |

---

### 1.3 Open Graph (OG Tags) & Social Preview

**Цель:** Корректные превью при шеринге в Telegram / WhatsApp / Socials.

#### Добавить в Root Layout (`src/routes/__root.tsx`)

```ts
meta: [
  // ...существующие...
  { property: "og:title", content: "Orbit CRM — Панель управления" },
  {
    property: "og:description",
    content: "Персональная CRM-система для управления записями, клиентами и финансами",
  },
  { property: "og:image", content: "/og-image.png" },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:url", content: "https://wellness-flow-crm.vercel.app" },
  { property: "og:type", content: "website" },
  { property: "og:locale", content: "ru_RU" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: "Orbit CRM" },
  {
    name: "twitter:description",
    content: "Персональная CRM-система для управления записями и клиентами",
  },
  { name: "twitter:image", content: "/og-image.png" },
];
```

#### OG Image (`public/og-image.png`)

- Размер: 1200×630 px.
- Содержимое: логотип Orbit CRM по центру на тёмном фоне (#0a0f1a), текст «Orbit CRM — Панель управления».
- Создать через Figma / Canva / SVG → PNG через `sharp`.

#### Per-Route OG Override

Каждый дочерний роут (index, tasks, mail, finance) уже переопределяет `og:title` и `og:description`. Добавить также `og:image` с уникальным превью для каждого (опционально, можно переиспользовать общий).

---

## 2. Адаптивный Логотип и Шапка

### 2.1 Динамический логотип в сайдбаре

**Текущее состояние:** `src/components/crm/AppShell.tsx:43-52`  
Сайдбар — фиксированный слева, `w-64` (16rem). Иконка — Lucide `Sparkles` в gradient box. Текст — "Orbit CRM" + "персональная система".

#### Задачи

1. **Создать SVG-компонент логотипа** (`src/components/crm/OrbitLogo.tsx`):
   - `OrbitLogoFull` — полная версия (иконка + текст "Orbit CRM").
   - `OrbitLogoIcon` — только иконка (орбита без текста).
   - Импортировать SVG из `public/logo-icon.svg` или встроить inline.

2. **Реализовать toggle сайдбара:**
   - Добавить стейт `sidebarCollapsed: boolean` в `AppShell` (или поднять в `CrmProvider`).
   - Кнопка сворачивания: иконка `PanelLeftClose` / `PanelLeftOpen` в нижней части сайдбара или в хедере.
   - При `sidebarCollapsed = true`: сайдбар `w-64` → `w-16` (64px), скрыть текст, показать только иконку.
   - При `sidebarCollapsed = false`: полная версия `w-64`.

3. **Анимация перехода:**
   - CSS transition `width 200ms ease-in-out` на `<aside>`.
   - Текст скрывать через `opacity-0` → `hidden` при сворачивании (без layout shift).

#### Изменения в `src/components/crm/AppShell.tsx`

```tsx
// Стейт
const [collapsed, setCollapsed] = useState(false);

// Aside
<aside
  className={cn(
    "fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl transition-all duration-200",
    collapsed ? "w-16" : "w-64",
    "hidden lg:flex",
  )}
>
  {/* Логотип */}
  <div className="flex items-center gap-3 px-4 py-6">
    {collapsed ? <OrbitLogoIcon className="size-8" /> : <OrbitLogoFull className="h-8" />}
  </div>

  {/* Навигация */}
  <nav className="flex flex-1 flex-col gap-1 px-2">
    {nav.map((item) => (
      <Link className={cn("...", collapsed && "justify-center")}>
        <item.icon className="size-4" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    ))}
  </nav>

  {/* Кнопка сворачивания */}
  <button onClick={() => setCollapsed(!collapsed)} className="mx-auto mb-4">
    {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
  </button>
</aside>;
```

---

### 2.2 Верхняя панель (Header) — Название

**Текущее состояние:** `src/components/crm/AppShell.tsx:92-135`  
Header показывает `title` и `subtitle` (passed as props). В хедере нет названия "Orbit CRM".

#### Задачи

1. В хедере (`AppShell.tsx:93`) добавить логотип/текст "Orbit CRM" слева:
   - На desktop: показывать "Orbit CRM" рядом с заголовком страницы.
   - На mobile: показывать "Orbit" (сокращённо) или логотип-иконку.

2. Реализация:

```tsx
<header className="sticky top-0 z-20 glass">
  <div className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-8">
    {/* Логотип в хедере (мобильная версия) */}
    <div className="lg:hidden">
      <OrbitLogoIcon className="size-8" />
    </div>
    <div className="min-w-0 flex-1">
      <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
      {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
    </div>
    {/* ...остальные элементы... */}
  </div>
</header>
```

3. На desktop (lg+) сайдбар уже содержит логотип → в хедере дублировать не нужно.

---

## 3. Маршрутизация и Главная страница

### 3.1 Проблема: /book перекрывает CRM

**Текущее состояние:** Роут `/book` **не существует** в коде (поиск вернул 0 совпадений). Если форма бронирования部署ена отдельно или через Lovable, нужно убедиться, что она не перехватывает корневой роут.

#### Задачи

1. **Создать изолированный роут `/book`:**
   - Файл: `src/routes/book.tsx`
   - Компонент: `BookingPage` — клиентская форма записи (публичная, без auth).
   - **Не использовать `AppShell`** — это отдельная страница без сайдбара/хедера.

2. **Настроить редирект с `/` на dashboard:**
   - В `src/routes/__root.tsx` или `src/router.tsx` убедиться, что `/` ведёт на Dashboard.
   - Если ранее был редирект `/` → `/book`, удалить его.

3. **Настроить Vercel Routing** (`vercel.json` в корне проекта):

   ```json
   {
     "rewrites": [{ "source": "/book", "destination": "/book" }],
     "redirects": [{ "source": "/", "destination": "/", "permanent": false }]
   }
   ```
   - Убедиться, что TanStack Start SSR обрабатывает все роуты корректно.

4. **Структура `src/routes/book.tsx`:**
   ```tsx
   export const Route = createFileRoute("/book")({
     component: BookingPage,
   });

   function BookingPage() {
     return (
       <div className="min-h-screen bg-background">
         {/* Форма бронирования — отдельный layout без AppShell */}
         <BookingForm />
       </div>
     );
   }
   ```

---

## 4. Объединение модулей «Заявки» и «Записи»

### 4.1 Текущее состояние

- **Нет вкладки "Записи"** — она не реализована.
- **Нет вкладки "Заявки"** — она не реализована.
- Есть: `/tasks` (Канбан/Список/Карта), `/mail`, `/finance`.

### 4.2 Задачи

1. **Создать новый роут `/requests`:**
   - Файл: `src/routes/requests.tsx`
   - Навигационный элемент в сайдбаре: `{ to: "/requests", label: "Заявки и записи", icon: ClipboardList }`
   - Добавить в массив `nav` в `AppShell.tsx:19-24`.

2. **Единый интерфейс "Заявки и записи":**
   - Табы внутри страницы:
     - **Входящие заявки** — новые заявки от клиентов (статус: `new`, `pending`).
     - **Подтверждённые записи** — заявки, переведённые в запись (статус: `confirmed`, `completed`).
     - **Архив** — отменённые / завершённые.
   - Использовать `@radix-ui/react-tabs` (уже установлен).

3. **Таблица заявок** (shadcn/ui `Table`):
   - Колонки: Клиент, Услуга, Дата/Время, Статус, Действия.
   - Статусы: `new` (Новая), `pending` (Ожидает), `confirmed` (Подтверждена), `completed` (Завершена), `cancelled` (Отменена).
   - Действия: кнопка «Подтвердить» / «Отменить» / «Перевести в запись».

4. **Backend / API (Supabase):**
   - Таблица `bookings` (см. раздел 5.3 — Календарь, общая сущность).
   - Фильтрация по статусу через RLS или query params.

---

## 5. Интерактивный Календарь (Drag-and-Drop)

### 5.1 Установка библиотек

```bash
bun add @hello-pangea/dnd
```

- `@hello-pangea/dnd` — активно поддерживаемый форк `react-beautiful-dnd`, совместим с React 19.
- Альтернатива: `@dnd-kit/core` + `@dnd-kit/sortable` (более гибкая, но сложнее).

### 5.2 Роут и структура

**Файл:** `src/routes/calendar.tsx`

```
src/routes/calendar.tsx          — страница календаря
src/components/crm/calendar/
  ├── CalendarHeader.tsx         — переключатель День/Неделя/Месяц + навигация (‹ › Today)
  ├── DayView.tsx                — вид на один день (часовые слоты 00:00–23:00)
  ├── WeekView.tsx               — вид на неделю (7 колонок × слоты)
  ├── MonthView.tsx              — месяц (стандартная сетка)
  ├── CalendarEvent.tsx          — карточка события (перетаскиваемая)
  └── StatusBadge.tsx            — бейдж статуса записи
```

#### Навигация в сайдбаре

Добавить в `nav` массив (`AppShell.tsx:19-24`):

```ts
{ to: "/calendar", label: "Календарь", icon: Calendar }
```

### 5.3 Типы данных и Supabase

#### Таблица `bookings` (Supabase)

```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'pending', 'confirmed', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bookings_start_time ON bookings(start_time);
CREATE INDEX idx_bookings_client_id ON bookings(client_id);
CREATE INDEX idx_bookings_status ON bookings(status);
```

#### Типы (TypeScript)

```ts
// src/lib/crm-data.ts (добавить)

type BookingStatus = "new" | "pending" | "confirmed" | "completed" | "cancelled";

interface Booking {
  id: string;
  clientId: string | null;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  notes?: string;
}
```

### 5.4 DayView — Реализация

- **Контейнер:** Высота = `24 * 64px` (слот по 64px на час).
- **Временная сетка:** Колонка с отметками часов (00:00, 01:00, ..., 23:00) слева.
- **События:** Абсолютно позиционированные `CalendarEvent` компоненты внутри `Droppable`.
- **Droppable zones:** Каждый час — отдельная droppable зона (`droppableId: "day-2026-08-08-hour-14"`).

```tsx
// Пример DayView
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

function DayView({ date, events }: { date: Date; events: Booking[] }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    // Парсинг: droppableId →新的 дата/время
    // Вызов API для обновления записи
    updateBookingTime(result.draggableId, result.destination.droppableId);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex">
        {/* Ось времени */}
        <div className="w-16 flex-shrink-0">
          {hours.map((h) => (
            <div key={h} className="h-16 border-b border-border text-xs text-muted-foreground">
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Слоты */}
        <div className="flex-1 relative">
          {hours.map((h) => (
            <Droppable key={h} droppableId={`hour-${h}`}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="h-16 border-b border-border"
                />
              )}
            </Droppable>
          ))}

          {/* События */}
          {events.map((ev, i) => (
            <Draggable key={ev.id} draggableId={ev.id} index={i}>
              {(provided) => (
                <CalendarEvent
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  {...provided.dragHandleProps}
                  booking={ev}
                />
              )}
            </Draggable>
          ))}
        </div>
      </div>
    </DragDropContext>
  );
}
```

### 5.5 WeekView — Реализация

- 7 колонок (Пн–Вс), в каждой — те же hour-слоты.
- `Droppable` зоны: `droppableId: "week-2026-W32-day-1-hour-14"` (неделя-день-час).
- При перетаскивании между днями — обновлять и дату, и время.

### 5.6 MonthView — Реализация

- Стандартная сетка календаря (7×5/6 ячеек).
- В ячейках — список событий дня (макс. 3, + «ещё N»).
- Клик по ячейке → переход в DayView на эту дату.
- **Без drag-and-drop в месячном виде** (только навигация).

### 5.7 Drag-and-Drop — Логика обновления API

```ts
// src/lib/crm-store.tsx (добавить функцию)

async function moveBooking(bookingId: string, newStartTime: Date, newEndTime: Date) {
  // Обновление через Supabase client
  const { error } = await supabase
    .from("bookings")
    .update({ start_time: newStartTime.toISOString(), end_time: newEndTime.toISOString() })
    .eq("id", bookingId);

  if (error) throw error;

  // Обновление локального стейта
  setBookings((prev) =>
    prev.map((b) =>
      b.id === bookingId ? { ...b, startTime: newStartTime, endTime: newEndTime } : b,
    ),
  );
}
```

### 5.8 Смена статуса из календаря

- На `CalendarEvent` (карточке события) — кнопка с текущим статусом (dropdown).
- При клике: выбор нового статуса → вызов API `updateBookingStatus(id, newStatus)`.
- Цвета статусов:
  - `new` — синий
  - `pending` — жёлтый
  - `confirmed` — зелёный
  - `completed` — серый
  - `cancelled` — красный

---

## 6. Вкладка «Клиенты» и Сегментация

### 6.1 Роут и структура

**Файл:** `src/routes/clients.tsx`

```
src/routes/clients.tsx              — страница клиентов
src/components/crm/clients/
  ├── ClientsTable.tsx              — таблица всех клиентов
  ├── ClientCard.tsx                — карточка клиента (детальная информация)
  ├── ClientForm.tsx                — форма создания/редактирования клиента
  ├── SegmentFilter.tsx             — фильтр по сегментам
  └── ClientHistory.tsx             — история визитов
```

#### Навигация в сайдбаре

Добавить в `nav` массив (`AppShell.tsx:19-24`):

```ts
{ to: "/clients", label: "Клиенты", icon: Users }
```

### 6.2 Таблица `clients` (Supabase)

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  segment TEXT NOT NULL DEFAULT 'first_time'
    CHECK (segment IN ('first_time', 'regular', 'referral', 'lost')),
  notes TEXT,
  first_visit_date DATE,
  last_visit_date DATE,
  total_visits INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clients_segment ON clients(segment);
CREATE INDEX idx_clients_last_visit ON clients(last_visit_date);
```

### 6.3 Типы (TypeScript)

```ts
// src/lib/crm-data.ts (добавить)

type ClientSegment = "first_time" | "regular" | "referral" | "lost";

interface Client {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  segment: ClientSegment;
  notes: string | null;
  firstVisitDate: Date | null;
  lastVisitDate: Date | null;
  totalVisits: number;
  createdAt: Date;
}
```

### 6.4 UI — Таблица клиентов

**Компонент:** `ClientsTable.tsx`

| Колонка         | Описание                                  |
| --------------- | ----------------------------------------- |
| Имя             | `full_name`, клик → открытие `ClientCard` |
| Телефон         | `phone` с иконкой `Phone`                 |
| Email           | `email` с иконкой `Mail`                  |
| Сегмент         | Бейдж с цветом (см. ниже)                 |
| Первый визит    | `first_visit_date` (формат: DD.MM.YYYY)   |
| Последний визит | `last_visit_date` (формат: DD.MM.YYYY)    |
| Визитов         | `total_visits`                            |
| Действия        | Edit / Delete                             |

### 6.5 Сегменты клиентов

| Сегмент      | Лейбл             | Цвет          | Описание                         |
| ------------ | ----------------- | ------------- | -------------------------------- |
| `first_time` | Первичный         | Синий         | Нет записей или 1 визит          |
| `regular`    | Постоянный клиент | Зелёный       | ≥ 2 визитов за последние 90 дней |
| `referral`   | Реферал           | Фиолетовый    | Отметка «по рекомендации»        |
| `lost`       | Потерянный        | Серый/Красный | Нет визитов > 90 дней            |

#### Авто-определение сегмента (SQL / функция)

```sql
-- Функция для обновления сегмента клиента
CREATE OR REPLACE FUNCTION update_client_segment()
RETURNS TRIGGER AS $$
BEGIN
  NEW.segment := CASE
    WHEN NEW.total_visits <= 1 THEN 'first_time'
    WHEN NEW.last_visit_date < NOW() - INTERVAL '90 days' THEN 'lost'
    WHEN NEW.total_visits >= 2 AND NEW.last_visit_date >= NOW() - INTERVAL '90 days' THEN 'regular'
    ELSE NEW.segment
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_client_segment
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_client_segment();
```

### 6.6 Удаление нерелевантных статусов

- В таблице `bookings` (и в UI) — убрать статус "Повторный контакт" (если существует в моковых данных).
- Оставить только: `new`, `pending`, `confirmed`, `completed`, `cancelled`.

---

## 7. Retention & Напоминания (90 дней)

### 7.1 Авто-определение «уснувших» клиентов

**Критерий:** Клиент, у которого `last_visit_date` старше 90 дней от текущей даты.

#### SQL-запрос (для ручной проверки)

```sql
SELECT * FROM clients
WHERE last_visit_date < NOW() - INTERVAL '90 days'
  OR last_visit_date IS NULL
ORDER BY last_visit_date ASC NULLS FIRST;
```

#### Триггер для авто-обновления сегмента (уже в разделе 6.5)

Триггер `trg_update_client_segment` при каждом обновлении `clients` автоматически ставит `segment = 'lost'`, если `last_visit_date` > 90 дней.

### 7.2 Cron-job / Worker (Supabase Edge Function)

**Edge Function:** `supabase/functions/check-inactive-clients/index.ts`

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Найти клиентов без визитов > 90 дней
  const { data: inactiveClients, error } = await supabase
    .from("clients")
    .select("id, full_name, phone, email, last_visit_date")
    .or(
      `last_visit_date.lt.${new Date(Date.now() - 90 * 86400000).toISOString()},last_visit_date.is.null`,
    )
    .eq("segment", "lost");

  if (error) throw error;

  // Обновить сегмент
  if (inactiveClients && inactiveClients.length > 0) {
    const ids = inactiveClients.map((c) => c.id);
    await supabase.from("clients").update({ segment: "lost" }).in("id", ids);
  }

  return new Response(JSON.stringify({ checked: inactiveClients?.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

#### Расписание (pg_cron или Supabase Cron)

```sql
-- Если pg_cron установлен
SELECT cron.schedule(
  'check-inactive-clients',
  '0 9 * * *',  -- Каждый день в 09:00 UTC
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/check-inactive-clients',
    headers := '{"Authorization": "Bearer " || current_setting('app.settings.service_role_key')}'
  ); $$
);
```

Альтернатива: настроить cron через Vercel Cron Jobs (`vercel.json`):

```json
{
  "crons": [
    {
      "path": "/api/cron/check-inactive-clients",
      "schedule": "0 9 * * *"
    }
  ]
}
```

### 7.3 UI — Рассылка «уснувшим» клиентам

**Компонент:** `src/components/crm/clients/RetentionPanel.tsx`

Размещение: вкладка на странице `/clients` или отдельный блок на Dashboard.

#### Элементы UI

1. **Счётчик:** «12 клиентов без визитов > 90 дней» (красный бейдж).
2. **Таблица «уснувших»:** Имя, Телефон, Email, Дата последнего визита, Дней с момента визита.
3. **Кнопка «Выбрать всех»** + чекбоксы рядом с каждым клиентом.
4. **Кнопка «Отправить напоминание»** → открывает модалку.

#### Модалка рассылки (`@radix-ui/react-dialog`)

- **Канал связи:** Radio group — WhatsApp / Telegram / SMS.
- **Шаблон сообщения:** Текстовое поле с предустановленным шаблоном:
  ```
  Привет, {name}! Давно не виделись 😊 Мы скучаем по вам.
  Хотим напомнить о записи — звоните или записывайтесь онлайн!
  ```
- **Кнопка «Отправить»** → вызов Edge Function для отправки.

#### Edge Function для отправки (`supabase/functions/send-reminders/index.ts`)

```ts
serve(async (req) => {
  const { clientIds, channel, messageTemplate } = await req.json();

  // Получить клиентов по IDs
  const clients = await supabase.from("clients").select("*").in("id", clientIds);

  // Для каждого клиента:
  // - Подставить {name}, {lastVisitDate} в шаблон
  // - Отправить через WhatsApp Business API / Telegram Bot API / SMS provider

  return new Response(JSON.stringify({ sent: clients.data?.length ?? 0 }));
});
```

---

## Чек-лист: Статус задач

| #   | Задача                                      | Frontend                                 | Backend/DB                          | UI/UX                                   | Статус |
| --- | ------------------------------------------- | ---------------------------------------- | ----------------------------------- | --------------------------------------- | ------ |
| 1.1 | Favicon + apple-touch-icon + manifest       | `__root.tsx` links, `public/` файлы      | —                                   | Иконка 32×32, 180×180                   | ⬜     |
| 1.2 | Meta title + description (root + per-route) | `__root.tsx` meta, per-route head        | —                                   | Title bar браузера                      | ⬜     |
| 1.3 | OG tags + og:image                          | `__root.tsx` meta, `public/og-image.png` | —                                   | Social preview 1200×630                 | ⬜     |
| 2.1 | Динамический логотип в сайдбаре             | `AppShell.tsx`, `OrbitLogo.tsx`          | —                                   | Collapsed/expanded sidebar              | ⬜     |
| 2.2 | Название "Orbit CRM" в хедере               | `AppShell.tsx` header section            | —                                   | Mobile header logo                      | ⬜     |
| 3.1 | Роут `/book` (изолированная форма)          | `src/routes/book.tsx`                    | —                                   | Публичная страница                      | ⬜     |
| 3.2 | Редирект `/` → dashboard                    | `__root.tsx`, `vercel.json`              | —                                   | Корректный entry point                  | ⬜     |
| 4.1 | Роут `/requests` — «Заявки и записи»        | `src/routes/requests.tsx`, сайдбар nav   | `bookings` table                    | Табы: Входящие / Подтверждённые / Архив | ⬜     |
| 5.1 | Установка `@hello-pangea/dnd`               | `package.json`                           | —                                   | —                                       | ⬜     |
| 5.2 | Day/Week/Month views                        | `src/routes/calendar.tsx`, компоненты    | `bookings` table                    | Часовые слоты, drag-and-drop            | ⬜     |
| 5.3 | Drag-and-Drop логика                        | `@hello-pangea/dnd`, `moveBooking()`     | UPDATE bookings                     | Перетаскивание между слотами            | ⬜     |
| 5.4 | Смена статуса из календаря                  | `CalendarEvent.tsx` dropdown             | UPDATE bookings.status              | Цветовые бейджи                         | ⬜     |
| 6.1 | Роут `/clients`                             | `src/routes/clients.tsx`, сайдбар nav    | `clients` table                     | Таблица + фильтры                       | ⬜     |
| 6.2 | Сегменты клиентов                           | `SegmentFilter.tsx`, бейджи              | `clients.segment` + триггер         | 4 сегмента с цветами                    | ⬜     |
| 6.3 | История визитов                             | `ClientHistory.tsx`                      | `bookings` join `clients`           | First/last visit dates                  | ⬜     |
| 7.1 | Auto-detect lost clients (90 дней)          | —                                        | SQL триггер `update_client_segment` | —                                       | ⬜     |
| 7.2 | Cron-job проверки                           | Edge Function                            | pg_cron / Vercel Cron               | —                                       | ⬜     |
| 7.3 | UI рассылки напоминаний                     | `RetentionPanel.tsx`, модалка            | Edge Function `send-reminders`      | WhatsApp / Telegram / SMS               | ⬜     |

---

## Приоритет выполнения

| Приоритет         | Задачи                                               | Оценка   |
| ----------------- | ---------------------------------------------------- | -------- |
| **P0 — Критично** | 1.1 (Favicon), 1.2 (Meta), 3.1-3.2 (Routing)         | 1-2 дня  |
| **P1 — Высокий**  | 2.1-2.2 (Logo/Header), 4.1 (Заявки+Записи)           | 2-3 дня  |
| **P2 — Средний**  | 5.1-5.4 (Календарь + DnD)                            | 3-5 дней |
| **P3 — Низкий**   | 6.1-6.3 (Клиенты + Сегментация), 7.1-7.3 (Retention) | 3-5 дней |
