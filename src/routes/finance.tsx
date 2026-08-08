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
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { monthly } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

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
  const { txs } = useCrm();
  const [view, setView] = useState<"area" | "bar">("area");

  const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    txs.filter((t) => t.type === "expense").forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amount));
    return [...map].map(([name, value]) => ({ name, value }));
  }, [txs]);

  return (
    <AppShell title="Финансы" subtitle="Август 2026 · доходы, расходы и структура">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Доход" value={income} tone="up" />
        <Kpi label="Расход" value={expense} tone="down" />
        <Kpi label="Чистыми" value={income - expense} tone="up" />
      </div>

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
                  <XAxis dataKey="m" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
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
                  <XAxis dataKey="m" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
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
          </div>
        </section>

        <section className="panel p-6">
          <h3 className="text-base font-semibold">Структура расходов</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={4}>
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
          </div>
          <div className="space-y-2">
            {byCategory.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="flex-1 text-muted-foreground">{c.name}</span>
                <span>{c.value.toLocaleString("ru-RU")} €</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-6 overflow-hidden">
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
            {txs.map((t) => (
              <tr key={t.id} className="transition hover:bg-surface-2/50">
                <td className="px-4 py-3">{t.label}</td>
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
      <p className={cn("mt-1 flex items-center gap-1 text-xs", tone === "up" ? "text-acc-1" : "text-acc-4")}>
        {tone === "up" ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
        к прошлому месяцу
      </p>
    </div>
  );
}
