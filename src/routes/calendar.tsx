import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  GripVertical,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { useCrm } from "@/lib/crm-store";
import {
  fetchCalendarEvents,
  updateCalendarEvent,
  type CalendarEventStatus,
} from "@/lib/calendar-repository";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Календарь — Orbit CRM" },
      {
        name: "description",
        content: "Интерактивный календарь записей с поддержкой drag-and-drop",
      },
      { property: "og:title", content: "Календарь — Orbit CRM" },
      { property: "og:description", content: "Расписание и записи" },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: CalendarPage,
});

type ViewMode = "day" | "week" | "month";
type BookingStatus = CalendarEventStatus;

interface CalendarEvent {
  id: string;
  title: string;
  clientName: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  dayIndex: number;
  startsAt: string;
  endsAt: string;
  dateKey: string;
  reminderAt: string | null;
  reminderSentAt: string | null;
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7);
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAYS_FULL = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

const STATUS_COLORS: Record<BookingStatus, string> = {
  new: "border-l-badge-blue bg-badge-blue-bg",
  pending: "border-l-badge-yellow bg-badge-yellow-bg",
  confirmed: "border-l-badge-green bg-badge-green-bg",
  completed: "border-l-badge-gray bg-badge-gray-bg",
  cancelled: "border-l-badge-red bg-badge-red-bg",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  new: "Новая",
  pending: "Ожидает",
  confirmed: "Подтверждена",
  completed: "Завершена",
  cancelled: "Отменена",
};

function CalendarPage() {
  const { organization } = useCrm();
  const [view, setView] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const weekStart = useMemo(() => {
    const value = new Date(currentDate);
    const day = value.getDay() || 7;
    value.setDate(value.getDate() - day + 1);
    value.setHours(0, 0, 0, 0);
    return value;
  }, [currentDate]);

  const loadEvents = useCallback(async () => {
    if (!organization) return;
    const rangeStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const rangeEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 1);
    try {
      const rows = await fetchCalendarEvents(organization.id, rangeStart, rangeEnd);
      setEvents(
        rows.map((row) => {
          const start = new Date(row.starts_at);
          const end = new Date(row.ends_at);
          return {
            id: row.id,
            title: row.title,
            clientName: row.client_name,
            startTime: start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
            endTime: end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
            status: row.status,
            dayIndex: Math.floor((start.getTime() - weekStart.getTime()) / 86_400_000),
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            dateKey: `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`,
            reminderAt: row.reminder_at,
            reminderSentAt: row.reminder_sent_at,
          };
        }),
      );
      setCalendarError(null);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Не удалось загрузить календарь");
    }
  }, [currentDate, organization, weekStart]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  const handleDragStart = (id: string) => setDraggedId(id);

  const handleDrop = async (dayIndex: number, hour: number) => {
    if (!draggedId) return;
    const event = events.find((item) => item.id === draggedId);
    if (!event || !organization) return;
    const startsAt = new Date(weekStart);
    startsAt.setDate(startsAt.getDate() + dayIndex);
    startsAt.setHours(hour, 0, 0, 0);
    const duration = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();
    const endsAt = new Date(startsAt.getTime() + Math.max(duration, 30 * 60_000));
    await updateCalendarEvent(organization.id, event.id, {
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    });
    setDraggedId(null);
    await loadEvents();
  };

  const changeStatus = async (id: string, status: BookingStatus) => {
    if (!organization) return;
    await updateCalendarEvent(organization.id, id, { status });
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, status } : e)));
  };

  const toggleReminder = async (id: string) => {
    if (!organization) return;
    const event = events.find((item) => item.id === id);
    if (!event || event.reminderSentAt) return;
    const reminderAt = event.reminderAt
      ? null
      : new Date(new Date(event.startsAt).getTime() - 30 * 60_000).toISOString();
    try {
      const updated = await updateCalendarEvent(organization.id, id, {
        reminder_at: reminderAt,
      });
      setEvents((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                reminderAt: updated.reminder_at,
                reminderSentAt: updated.reminder_sent_at,
              }
            : item,
        ),
      );
      setCalendarError(null);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Не удалось обновить напоминание");
    }
  };

  const getHeaderText = () => {
    const month = currentDate.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    return month.charAt(0).toUpperCase() + month.slice(1);
  };

  return (
    <AppShell title="Календарь" subtitle="Расписание и записи клиентов">
      <div className="space-y-4">
        {calendarError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {calendarError}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground transition hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => navigate(1)}
              className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground transition hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              onClick={goToday}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:border-primary/50"
            >
              Сегодня
            </button>
            <h2 className="ml-2 text-lg font-semibold">{getHeaderText()}</h2>
          </div>
          <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-sm font-medium transition",
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "day" ? "День" : v === "week" ? "Неделя" : "Месяц"}
              </button>
            ))}
          </div>
        </div>

        {view === "day" && (
          <DayView
            events={events}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onChangeStatus={changeStatus}
            onToggleReminder={toggleReminder}
          />
        )}
        {view === "week" && (
          <WeekView
            events={events}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onChangeStatus={changeStatus}
            onToggleReminder={toggleReminder}
          />
        )}
        {view === "month" && <MonthView currentDate={currentDate} events={events} />}
      </div>
    </AppShell>
  );
}

function EventCard({
  event,
  onDragStart,
  onChangeStatus,
  onToggleReminder,
}: {
  event: CalendarEvent;
  onDragStart: (id: string) => void;
  onChangeStatus: (id: string, status: BookingStatus) => void;
  onToggleReminder: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(event.id)}
      className={cn(
        "group cursor-grab rounded-lg border-l-2 p-2 text-xs transition hover:shadow-md active:cursor-grabbing",
        STATUS_COLORS[event.status],
      )}
    >
      <div className="flex items-center gap-1">
        <GripVertical className="size-3 opacity-0 transition group-hover:opacity-50" />
        <span className="flex-1 truncate font-medium">{event.clientName}</span>
      </div>
      <p className="mt-0.5 truncate text-muted-foreground">{event.title}</p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {event.startTime}–{event.endTime}
        </span>
        <select
          value={event.status}
          onChange={(e) => onChangeStatus(event.id, e.target.value as BookingStatus)}
          className="rounded bg-transparent text-[10px] outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k} className="bg-surface-2 text-foreground">
              {v}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={Boolean(event.reminderSentAt)}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          onToggleReminder(event.id);
        }}
        title={
          event.reminderSentAt
            ? "Напоминание доставлено"
            : event.reminderAt
              ? "Отменить напоминание"
              : "Напомнить за 30 минут"
        }
        className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-default"
      >
        {event.reminderAt ? <Bell className="size-3" /> : <BellOff className="size-3" />}
        {event.reminderSentAt
          ? "Доставлено"
          : event.reminderAt
            ? `Напоминание ${new Date(event.reminderAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
            : "Без напоминания"}
      </button>
    </div>
  );
}

function DayView({
  events,
  onDragStart,
  onDrop,
  onChangeStatus,
  onToggleReminder,
}: {
  events: CalendarEvent[];
  onDragStart: (id: string) => void;
  onDrop: (dayIndex: number, hour: number) => void;
  onChangeStatus: (id: string, status: BookingStatus) => void;
  onToggleReminder: (id: string) => void;
}) {
  return (
    <div className="flex rounded-xl border border-border bg-surface-2/40">
      <div className="w-16 flex-shrink-0 border-r border-border">
        {HOURS.map((h) => (
          <div
            key={h}
            className="h-16 border-b border-border px-2 pt-1 text-[10px] text-muted-foreground"
          >
            {String(h).padStart(2, "0")}:00
          </div>
        ))}
      </div>
      <div className="flex-1">
        {HOURS.map((h) => (
          <div
            key={h}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(0, h)}
            className="h-16 border-b border-border transition hover:bg-primary/5"
          >
            {events
              .filter((e) => parseInt(e.startTime) === h)
              .map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  onDragStart={onDragStart}
                  onChangeStatus={onChangeStatus}
                  onToggleReminder={onToggleReminder}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekView({
  events,
  onDragStart,
  onDrop,
  onChangeStatus,
  onToggleReminder,
}: {
  events: CalendarEvent[];
  onDragStart: (id: string) => void;
  onDrop: (dayIndex: number, hour: number) => void;
  onChangeStatus: (id: string, status: BookingStatus) => void;
  onToggleReminder: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40">
      <div className="grid grid-cols-8 border-b border-border">
        <div className="p-2 text-xs text-muted-foreground">Время</div>
        {DAYS.map((d, i) => (
          <div key={d} className="border-l border-border p-2 text-center">
            <span className="text-xs text-muted-foreground">{d}</span>
            <span className="ml-1 text-sm font-semibold">{8 + i}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-8">
        <div className="border-r border-border">
          {HOURS.map((h) => (
            <div
              key={h}
              className="h-14 border-b border-border px-2 pt-1 text-[10px] text-muted-foreground"
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {Array.from({ length: 7 }).map((_, dayIdx) => (
          <div key={dayIdx} className="border-l border-border">
            {HOURS.map((h) => (
              <div
                key={h}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(dayIdx, h)}
                className="h-14 border-b border-border p-0.5 transition hover:bg-primary/5"
              >
                {events
                  .filter((e) => e.dayIndex === dayIdx && parseInt(e.startTime) === h)
                  .map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      onDragStart={onDragStart}
                      onChangeStatus={onChangeStatus}
                      onToggleReminder={onToggleReminder}
                    />
                  ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthView({ currentDate, events }: { currentDate: Date; events: CalendarEvent[] }) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay === 0 ? 6 : firstDay - 1;

  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    if (day < 1 || day > daysInMonth) return null;
    return day;
  });

  return (
    <div className="rounded-xl border border-border bg-surface-2/40">
      <div className="grid grid-cols-7 border-b border-border">
        {DAYS.map((d) => (
          <div
            key={d}
            className="border-r border-border p-2 text-center text-xs font-medium text-muted-foreground last:border-r-0"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => (
          <div key={i} className="min-h-20 border-b border-r border-border p-1 last:border-r-0">
            {day && (
              <>
                <span className="text-xs text-muted-foreground">{day}</span>
                {events
                  .filter((event) => event.dateKey === `${year}-${month}-${day}`)
                  .slice(0, 2)
                  .map((e) => (
                    <div
                      key={e.id}
                      className={cn(
                        "mt-0.5 truncate rounded px-1 py-0.5 text-[10px]",
                        STATUS_COLORS[e.status],
                      )}
                    >
                      {e.clientName}
                    </div>
                  ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
