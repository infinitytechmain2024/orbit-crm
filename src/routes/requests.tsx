import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Filter, MoreHorizontal, Search, X, CalendarClock, User } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { useCrm } from "@/lib/crm-store";
import { fetchCalendarEvents, updateCalendarEvent } from "@/lib/calendar-repository";

export const Route = createFileRoute("/requests")({
  head: () => ({
    meta: [
      { title: "Заявки и записи — Orbit CRM" },
      {
        name: "description",
        content: "Управление входящими заявками и подтверждёнными записями клиентов",
      },
      { property: "og:title", content: "Заявки и записи — Orbit CRM" },
      { property: "og:description", content: "Управление заявками и записями" },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: RequestsPage,
});

type BookingStatus = "new" | "pending" | "confirmed" | "completed" | "cancelled";

interface Booking {
  id: string;
  clientName: string;
  service: string;
  date: string;
  time: string;
  status: BookingStatus;
  phone: string;
}

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  new: { label: "Новая", color: "text-badge-blue", bg: "bg-badge-blue-bg" },
  pending: { label: "Ожидает", color: "text-badge-yellow", bg: "bg-badge-yellow-bg" },
  confirmed: { label: "Подтверждена", color: "text-badge-green", bg: "bg-badge-green-bg" },
  completed: { label: "Завершена", color: "text-badge-gray", bg: "bg-badge-gray-bg" },
  cancelled: { label: "Отменена", color: "text-badge-red", bg: "bg-badge-red-bg" },
};

type Tab = "incoming" | "confirmed" | "archive";

function RequestsPage() {
  const { organization } = useCrm();
  const [activeTab, setActiveTab] = useState<Tab>("incoming");
  const [search, setSearch] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    if (!organization) return;
    try {
      const from = new Date();
      from.setFullYear(from.getFullYear() - 1);
      const to = new Date();
      to.setFullYear(to.getFullYear() + 2);
      const rows = await fetchCalendarEvents(organization.id, from, to);
      setBookings(
        rows.map((row) => {
          const startsAt = new Date(row.starts_at);
          return {
            id: row.id,
            clientName: row.client_name,
            service: row.title,
            date: startsAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }),
            time: startsAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
            status: row.status,
            phone: row.notes || "Контактные данные не указаны",
          };
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить записи");
    }
  }, [organization]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const changeStatus = async (id: string, status: BookingStatus) => {
    if (!organization) return;
    try {
      await updateCalendarEvent(organization.id, id, { status });
      setBookings((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить запись");
    }
  };

  const filtered = bookings.filter((b) => {
    const matchesSearch =
      b.clientName.toLowerCase().includes(search.toLowerCase()) ||
      b.service.toLowerCase().includes(search.toLowerCase());
    if (activeTab === "incoming")
      return matchesSearch && (b.status === "new" || b.status === "pending");
    if (activeTab === "confirmed")
      return matchesSearch && (b.status === "confirmed" || b.status === "completed");
    return matchesSearch && b.status === "cancelled";
  });

  return (
    <AppShell
      title="Заявки и записи"
      subtitle="Управление входящими заявками и подтверждёнными записями"
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени или услуге..."
              className="w-full rounded-xl border border-border bg-surface-2/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
            />
          </div>
          <button className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground">
            <Filter className="size-4" />
            Фильтр
          </button>
        </div>

        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
          {(
            [
              { id: "incoming", label: "Входящие" },
              { id: "confirmed", label: "Подтверждённые" },
              { id: "archive", label: "Архив" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface-2/40 p-8 text-center">
              <p className="text-sm text-muted-foreground">Нет записей</p>
            </div>
          ) : (
            filtered.map((booking) => (
              <div
                key={booking.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface-2/40 p-4 transition hover:border-primary/30"
              >
                <div className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
                  <User className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{booking.clientName}</p>
                  <p className="text-xs text-muted-foreground">{booking.phone}</p>
                </div>
                <div className="text-sm">
                  <p>{booking.service}</p>
                  <p className="text-xs text-muted-foreground">
                    {booking.date} в {booking.time}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    STATUS_CONFIG[booking.status].bg,
                    STATUS_CONFIG[booking.status].color,
                  )}
                >
                  {STATUS_CONFIG[booking.status].label}
                </span>
                <div className="flex gap-1">
                  {(booking.status === "new" || booking.status === "pending") && (
                    <>
                      <button
                        onClick={() => void changeStatus(booking.id, "confirmed")}
                        className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                        title="Подтвердить"
                      >
                        <Check className="size-4" />
                      </button>
                      <button
                        onClick={() => void changeStatus(booking.id, "cancelled")}
                        className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-red-400/50 hover:text-red-400"
                        title="Отменить"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  )}
                  <button
                    className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:text-foreground"
                    title="Подробнее"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
