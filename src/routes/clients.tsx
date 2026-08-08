import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Mail,
  Phone,
  Search,
  Filter,
  User,
  CalendarClock,
  TrendingDown,
  Star,
  Users,
  UserPlus,
  Send,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Клиенты — Orbit CRM" },
      {
        name: "description",
        content: "Управление базой клиентов, сегментация и история визитов",
      },
      { property: "og:title", content: "Клиенты — Orbit CRM" },
      { property: "og:description", content: "База клиентов и сегментация" },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: ClientsPage,
});

type ClientSegment = "first_time" | "regular" | "referral" | "lost";

interface Client {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  segment: ClientSegment;
  firstVisitDate: string;
  lastVisitDate: string;
  totalVisits: number;
}

const mockClients: Client[] = [
  {
    id: "c1",
    fullName: "Анна Смирнова",
    phone: "+7 (999) 123-45-67",
    email: "anna@mail.ru",
    segment: "regular",
    firstVisitDate: "15.03.2025",
    lastVisitDate: "05.08.2026",
    totalVisits: 12,
  },
  {
    id: "c2",
    fullName: "Иван Петров",
    phone: "+7 (916) 234-56-78",
    email: "ivan@gmail.com",
    segment: "first_time",
    firstVisitDate: "01.08.2026",
    lastVisitDate: "01.08.2026",
    totalVisits: 1,
  },
  {
    id: "c3",
    fullName: "Мария Козлова",
    phone: "+7 (903) 345-67-89",
    email: "maria@yandex.ru",
    segment: "referral",
    firstVisitDate: "20.01.2025",
    lastVisitDate: "03.08.2026",
    totalVisits: 8,
  },
  {
    id: "c4",
    fullName: "Дмитрий Волков",
    phone: "+7 (926) 456-78-90",
    email: "dmitry@mail.ru",
    segment: "lost",
    firstVisitDate: "10.05.2025",
    lastVisitDate: "15.04.2026",
    totalVisits: 5,
  },
  {
    id: "c5",
    fullName: "Елена Новикова",
    phone: "+7 (985) 567-89-01",
    email: "elena@gmail.com",
    segment: "regular",
    firstVisitDate: "01.02.2025",
    lastVisitDate: "07.08.2026",
    totalVisits: 20,
  },
  {
    id: "c6",
    fullName: "Ольга Романова",
    phone: "+7 (925) 678-90-12",
    email: "olga@mail.ru",
    segment: "lost",
    firstVisitDate: "05.06.2025",
    lastVisitDate: "20.03.2026",
    totalVisits: 3,
  },
];

const SEGMENT_CONFIG: Record<
  ClientSegment,
  { label: string; color: string; bg: string; icon: typeof Star }
> = {
  first_time: { label: "Первичный", color: "text-blue-400", bg: "bg-blue-400/12", icon: UserPlus },
  regular: { label: "Постоянный", color: "text-green-400", bg: "bg-green-400/12", icon: Star },
  referral: { label: "Реферал", color: "text-purple-400", bg: "bg-purple-400/12", icon: Users },
  lost: { label: "Потерянный", color: "text-red-400", bg: "bg-red-400/12", icon: TrendingDown },
};

function ClientsPage() {
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<ClientSegment | "all">("all");
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);

  const filtered = mockClients.filter((c) => {
    const matchesSearch =
      c.fullName.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const matchesSegment = segmentFilter === "all" || c.segment === segmentFilter;
    return matchesSearch && matchesSegment;
  });

  const lostClients = mockClients.filter((c) => c.segment === "lost");

  const toggleClient = (id: string) => {
    setSelectedClients((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <AppShell title="Клиенты" subtitle="Управление базой клиентов и сегментация">
      <div className="space-y-6">
        {lostClients.length > 0 && (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingDown className="size-5 text-red-400" />
                <div>
                  <p className="text-sm font-medium">Клиенты без визитов &gt; 90 дней</p>
                  <p className="text-xs text-muted-foreground">
                    {lostClients.length} клиент(ов) требуют внимания
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowReminderModal(true)}
                className="flex items-center gap-2 rounded-lg bg-red-400/12 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-400/20"
              >
                <Send className="size-3" />
                Напоминание
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени, телефону или email..."
              className="w-full rounded-xl border border-border bg-surface-2/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
            />
          </div>
          <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
            {(
              [
                { id: "all", label: "Все" },
                { id: "regular", label: "Постоянные" },
                { id: "first_time", label: "Первичные" },
                { id: "referral", label: "Рефералы" },
                { id: "lost", label: "Потерянные" },
              ] as const
            ).map((seg) => (
              <button
                key={seg.id}
                onClick={() => setSegmentFilter(seg.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  segmentFilter === seg.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {seg.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Клиент
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Контакты
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Сегмент
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Первый визит
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Последний визит
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                    Визитов
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((client) => {
                  const seg = SEGMENT_CONFIG[client.segment];
                  const SegIcon = seg.icon;
                  return (
                    <tr key={client.id} className="transition hover:bg-surface-2/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-8 place-items-center rounded-lg bg-primary/12 text-xs font-semibold text-primary">
                            {client.fullName.charAt(0)}
                          </div>
                          <span className="font-medium">{client.fullName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="size-3" /> {client.phone}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="size-3" /> {client.email}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            seg.bg,
                            seg.color,
                          )}
                        >
                          <SegIcon className="size-3" />
                          {seg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {client.firstVisitDate}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {client.lastVisitDate}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-semibold">
                        {client.totalVisits}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showReminderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface-2 p-6">
            <h3 className="text-lg font-semibold">Отправить напоминание</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Предложите клиентам вернуться. Выберите канал и шаблон.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <p className="mb-2 text-xs font-medium">Канал</p>
                <div className="flex gap-2">
                  {["WhatsApp", "Telegram", "SMS"].map((ch) => (
                    <button
                      key={ch}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs transition hover:border-primary/50"
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium">Шаблон сообщения</p>
                <textarea
                  rows={3}
                  defaultValue="Привет! Давно не виделись 😊 Мы скучаем по вам. Хотим напомнить о записи — звоните или записывайтесь онлайн!"
                  className="w-full resize-none rounded-xl border border-border bg-surface-2/60 p-3 text-sm outline-none transition focus:border-primary/60"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowReminderModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm transition hover:bg-surface-2"
              >
                Отмена
              </button>
              <button
                onClick={() => setShowReminderModal(false)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
