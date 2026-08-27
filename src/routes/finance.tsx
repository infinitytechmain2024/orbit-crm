import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Plus, CreditCard } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { cn } from "@/lib/utils";
import { StripePaymentForm } from "@/components/crm/StripePaymentForm";

export const Route = createFileRoute("/finance")({
  head: () => ({
    meta: [
      { title: "Финансы — Orbit CRM" },
      {
        name: "description",
        content: "Доходы, расходы и структура категорий с интерактивными графиками в личной CRM.",
      },
      { property: "og:title", content: "Финансы — Orbit CRM" },
      { property: "og:description", content: "Интерактивные графики доходов и расходов." },
    ],
  }),
  component: FinancePage,
});

const COLORS = ["var(--acc-1)", "var(--acc-2)", "var(--acc-3)", "var(--acc-4)"];

function FinancePage() {
  const { txs, stripeTransactions, stripeSubscriptions, isLoading } = useCrm();
  const [view, setView] = useState<"area" | "bar">("area");
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const allTransactions = useMemo(() => {
    const manual = txs.map((t) => ({
      ...t,
      source: "manual" as const,
      stripeId: null,
    }));

    const stripe = stripeTransactions.map((t) => ({
      id: t.id,
      label: t.description || t.stripePaymentIntentId,
      amount: t.amount,
      type: t.status === "succeeded" ? ("income" as const) : ("expense" as const),
      category: "Stripe",
      date: t.date,
      dateIso: t.dateIso,
      taskId: null,
      source: "stripe" as const,
      stripeId: t.stripePaymentIntentId,
    }));

    return [...manual, ...stripe].sort(
      (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime()
    );
  }, [txs, stripeTransactions]);

  const income = allTransactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = allTransactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const monthly = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("ru-RU", { month: "short" });
    const map = new Map<string, { m: string; income: number; expense: number }>();

    allTransactions.forEach((tx) => {
      const date = new Date(`${tx.dateIso}T00:00:00`);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const current = map.get(key) ?? { m: formatter.format(date), income: 0, expense: 0 };
      current[tx.type] += tx.amount;
      map.set(key, current);
    });

    return [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-6)
      .map(([, value]) => value);
  }, [allTransactions]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    allTransactions
      .filter((t) => t.type === "expense")
      .forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amount));
    return [...map].map(([name, value]) => ({ name, value }));
  }, [allTransactions]);

  const stripeIncome = stripeTransactions
    .filter((t) => t.status === "succeeded")
    .reduce((s, t) => s + t.amount, 0);

  const activeSubscriptions = stripeSubscriptions.filter(
    (s) => s.status === "active" || s.status === "trialing"
  );

  const mrr = activeSubscriptions
    .filter((s) => s.interval === "month")
    .reduce((s, sub) => s + sub.amount, 0);
  const arr = activeSubscriptions
    .filter((s) => s.interval === "year")
    .reduce((s, sub) => s + sub.amount / 12, 0);
  const totalMRR = mrr + arr;

  const handlePaymentSuccess = (paymentIntentId: string) => {
    setShowPaymentForm(false);
  };

  return (
    <AppShell title="Финансы" subtitle="Доходы, расходы и структура по данным Supabase + Stripe">
      {isLoading && (
        <div className="panel mb-6 p-6 text-sm text-muted-foreground">
          Загружаю финансовые операции из Supabase…
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Доход" value={income} tone="up" />
        <Kpi label="Расход" value={expense} tone="down" />
        <Kpi label="Чистыми" value={income - expense} tone="up" />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Stripe метрики</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPaymentForm(true)}
        >
          <Plus className="size-4 mr-2" />
          Принять платеж
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Kpi label="Stripe доходы" value={stripeIncome} tone="up" />
        <Kpi label="MRR (ежемесячно)" value={totalMRR} tone="up" />
        <Kpi label="Активные подписки" value={activeSubscriptions.length} tone="up" />
      </div>

      {showPaymentForm && (
        <div className="mt-4 panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Принять платеж через Stripe</h3>
            <button
              onClick={() => setShowPaymentForm(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
          <StripePaymentForm
            amount={100}
            currency="EUR"
            description="Тестовый платеж"
            onSuccess={handlePaymentSuccess}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <section className="panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Динамика по месяцам</h3>
            <div className="flex gap-1 rounded-lg border border-border p-1 text-xs">
              {(["area", "bar"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition",
                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {v === "area" ? "Область" : "Столбцы"}
                </button>
              ))}
            </div>
          </div>
          <div className="h-72">
            {monthly.length ? (
              <ResponsiveContainer width="100%" height="100%">
                {view === "area" ? (
                  <AreaChart data={monthly}>
                    <defs>
                      <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--acc-1)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="var(--acc-1)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--acc-4)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--acc-4)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="m"
                      stroke="var(--muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        color: "var(--foreground)",
                      }}
                    />
                    <Area dataKey="income" stroke="var(--acc-1)" fill="url(#gi)" strokeWidth={2} />
                    <Area dataKey="expense" stroke="var(--acc-4)" fill="url(#ge)" strokeWidth={2} />
                  </AreaChart>
                ) : (
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="m"
                      stroke="var(--muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--surface-2)" }}
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                      }}
                    />
                    <Bar dataKey="income" fill="var(--acc-1)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="expense" fill="var(--acc-4)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Финансовых операций пока нет.
              </div>
            )}
          </div>
        </section>

        <section className="panel p-6">
          <h3 className="text-base font-semibold">Структура расходов</h3>
          <div className="h-56">
            {byCategory.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={4}
                  >
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Расходов пока нет.
              </div>
            )}
          </div>
          <div className="space-y-2">
            {byCategory.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <span className="flex-1 text-muted-foreground">{c.name}</span>
                <span>{c.value.toLocaleString("ru-RU")} €</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">История операций</h3>
          <span className="text-xs text-muted-foreground">
            {allTransactions.length} операций
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Операция</th>
              <th className="px-4 py-3">Категория</th>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {allTransactions.map((t) => (
              <tr key={t.id} className="transition hover:bg-surface-2/50">
                <td className="px-4 py-3">
                  {t.label}
                  {t.source === "stripe" && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Stripe
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{t.category}</td>
                <td className="px-4 py-3 text-muted-foreground">{t.date}</td>
                <td
                  className={cn(
                    "px-4 py-3 text-right font-medium",
                    t.type === "income" ? "text-acc-1" : "text-acc-4",
                  )}
                >
                  {t.type === "income" ? "+" : "−"}
                  {t.amount.toLocaleString("ru-RU")} €
                </td>
              </tr>
            ))}
            {!allTransactions.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Операций пока нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: "up" | "down" }) {
  return (
    <div className="panel p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{value.toLocaleString("ru-RU")} €</p>
      <p
        className={cn(
          "mt-1 flex items-center gap-1 text-xs",
          tone === "up" ? "text-acc-1" : "text-acc-4",
        )}
      >
        {tone === "up" ? (
          <ArrowUpRight className="size-3.5" />
        ) : (
          <ArrowDownRight className="size-3.5" />
        )}
        по сохранённым операциям
      </p>
    </div>
  );
}