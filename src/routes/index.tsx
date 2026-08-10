import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowUpRight,
  Brain,
  CalendarClock,
  Check,
  Mail,
  Plus,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { QuickInputTextarea } from "@/components/crm/QuickInputTextarea";
import { STATUS_LABEL, type Priority } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orbit CRM — персональный командный центр" },
      {
        name: "description",
        content:
          "Дашборд личной CRM: быстрый ввод мыслей с разбором через ИИ, задачи, письма и финансы в одном месте.",
      },
      { property: "og:title", content: "Orbit CRM — персональный командный центр" },
      {
        property: "og:description",
        content: "Задачи, проекты, почта и финансы в одном премиальном тёмном интерфейсе.",
      },
    ],
  }),
  component: Dashboard,
});

const prioTone: Record<Priority, string> = {
  high: "text-acc-4 bg-acc-4/12",
  med: "text-acc-3 bg-acc-3/12",
  low: "text-acc-2 bg-acc-2/12",
};

function Dashboard() {
  const { tasks, emails, txs, addTask } = useCrm();
  const [draft, setDraft] = useState("");
  const [stage, setStage] = useState<"idle" | "loading" | "done">("idle");
  const [parsed, setParsed] = useState<{ title: string; priority: Priority }[]>([]);
  const [adding, setAdding] = useState(false);

  const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const open = tasks.filter((t) => t.status !== "completed" && !t.archivedAt);

  const analyze = () => {
    if (!draft.trim() || stage === "loading") return;
    setStage("loading");
    setParsed([]);
    setTimeout(() => {
      const parts = draft
        .split(/[\n,;.]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4);
      setParsed(
        (parts.length ? parts : [draft.trim()]).map((p, i) => ({
          title: p.charAt(0).toUpperCase() + p.slice(1),
          priority: (i === 0 ? "high" : i === 1 ? "med" : "low") as Priority,
        })),
      );
      setStage("done");
    }, 1600);
  };

  const accept = async () => {
    if (adding) return;
    setAdding(true);
    const results = await Promise.all(
      parsed.map((p) =>
        addTask({ title: p.title, priority: p.priority, status: "backlog", tags: ["ии"] }),
      ),
    );
    if (results.every(Boolean)) {
      setParsed([]);
      setDraft("");
      setStage("idle");
    }
    setAdding(false);
  };

  const addInboxTask = async () => {
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    const task = await addTask({ title });
    if (task) setDraft("");
    setAdding(false);
  };

  return (
    <AppShell title="Дашборд" subtitle="Суббота, 8 августа · всё важное на одном экране">
      <div className="grid gap-6 xl:grid-cols-3">
        <section className="panel relative overflow-hidden p-6 xl:col-span-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> быстрый ввод
          </div>
          <h2 className="mt-2 text-2xl">
            Выгрузите мысли — <span className="text-gradient">ИИ разложит по полкам</span>
          </h2>
          <QuickInputTextarea
            value={draft}
            onChange={setDraft}
            rows={3}
            placeholder="Например: позвонить Анне по договору, выставить счёт Nordwind, подготовить отчёт за июль"
            className="mt-4"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={analyze}
              disabled={stage === "loading"}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-acc-1 to-acc-2 px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-70"
            >
              <Brain className={cn("size-4", stage === "loading" && "animate-pulse")} />
              {stage === "loading" ? "ИИ думает…" : "Разобрать через ИИ"}
            </button>
            <button
              onClick={() => void addInboxTask()}
              disabled={adding}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground"
            >
              <Plus className="size-4" /> {adding ? "Сохраняю…" : "Просто во входящие"}
            </button>
          </div>

          {stage === "loading" && (
            <div className="mt-4 space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="shimmer h-12 rounded-xl bg-surface-2/70" />
              ))}
            </div>
          )}

          {stage === "done" && parsed.length > 0 && (
            <div className="mt-4 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs text-muted-foreground">
                ИИ предлагает {parsed.length} задач(и):
              </p>
              {parsed.map((p) => (
                <div
                  key={p.title}
                  className="flex items-center gap-3 rounded-lg bg-surface-2/70 px-3 py-2 text-sm animate-in fade-in slide-in-from-bottom-1"
                >
                  <Check className="size-4 text-primary" />
                  <span className="flex-1">{p.title}</span>
                  <span
                    className={cn("rounded-full px-2 py-0.5 text-[11px]", prioTone[p.priority])}
                  >
                    {p.priority}
                  </span>
                </div>
              ))}
              <button
                onClick={() => void accept()}
                disabled={adding}
                className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground"
              >
                {adding ? "Сохраняю…" : "Добавить в задачи"}
              </button>
            </div>
          )}
        </section>

        <section className="grid gap-4">
          <Metric
            icon={<Wallet className="size-4" />}
            label="Доход за месяц"
            value={`${income.toLocaleString("ru-RU")} €`}
            delta="+18%"
          />
          <Metric
            icon={<TrendingUp className="size-4" />}
            label="Чистая прибыль"
            value={`${(income - expense).toLocaleString("ru-RU")} €`}
            delta="+9%"
          />
          <Metric
            icon={<CalendarClock className="size-4" />}
            label="Открытых задач"
            value={String(open.length)}
            delta={`${tasks.filter((t) => t.priority === "high" && t.status !== "completed" && !t.archivedAt).length} срочных`}
          />
        </section>

        <section className="panel p-6 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Ближайшие задачи</h3>
            <Link to="/tasks" className="inline-flex items-center gap-1 text-xs text-primary">
              Все задачи <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {open.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-3">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    t.priority === "high" ? "bg-acc-4" : "bg-primary",
                  )}
                />
                <span className="flex-1 truncate text-sm">{t.title}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {STATUS_LABEL[t.status]}
                </span>
                <span className="w-14 text-right text-xs text-muted-foreground">
                  {t.due ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Последние письма</h3>
            <Link to="/mail" className="text-xs text-primary">
              Открыть
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {emails.slice(0, 4).map((e) => (
              <div key={e.id} className="flex gap-3">
                <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                  <Mail className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <p className={cn("truncate text-sm", e.unread && "font-semibold")}>{e.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.from}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Metric({
  icon,
  label,
  value,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta: string;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/12 text-primary">
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 font-display text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-primary">{delta}</p>
    </div>
  );
}
