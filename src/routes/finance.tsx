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
import { ArrowDownRight, ArrowUpRight, CreditCard, RefreshCw, Plus } from "lucide-react";
import { Trash2 } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { cn } from "@/lib/utils";
import { StripePaymentForm } from "@/components/crm/StripePaymentForm";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  convertCurrency,
  convertDisplayToEur,
  convertEurToDisplay,
  formatMoney,
  type DisplayCurrency,
  useExchangeRates,
} from "@/lib/currency";

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
  const {
    txs,
    stripeTransactions,
    stripeSubscriptions,
    currency,
    setCurrency,
    isLoading,
    addFinanceTransaction,
    deleteFinanceTransaction,
    updateFinanceTransaction,
  } = useCrm();
  const [view, setView] = useState<"area" | "bar">("area");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<"income" | "expense">("income");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Прочее");
  const { rates, status: ratesStatus, updatedAt: ratesUpdatedAt, reload: reloadRates } =
    useExchangeRates();
  const [occurredOn, setOccurredOn] = useState(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  });
  const [savingFinance, setSavingFinance] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedRate = rates[currency as DisplayCurrency] || 1;
  const toDisplayCurrency = (valueInEUR: number) =>
    convertEurToDisplay(valueInEUR, currency as DisplayCurrency, selectedRate);
  const toBaseEUR = (valueInDisplayCurrency: number) =>
    convertDisplayToEur(valueInDisplayCurrency, currency as DisplayCurrency, selectedRate);
  const convertCurrent = (amount: number, from: DisplayCurrency, to: DisplayCurrency) =>
    convertCurrency(amount, from, to, rates);

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
      (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime(),
    );
  }, [txs, stripeTransactions]);

  const income = allTransactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const expense = allTransactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const displayedIncome = toDisplayCurrency(income);
  const displayedExpense = toDisplayCurrency(expense);
  const displayedBalance = toDisplayCurrency(income - expense);

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

  const activeSubscriptions = stripeSubscriptions.filter(
    (s) => s.status === "active" || s.status === "trialing",
  );

  const handlePaymentSuccess = (paymentIntentId: string) => {
    setShowPaymentForm(false);
  };

  const resetFinanceForm = () => {
    setEditingId(null);
    setEntryType("income");
    setLabel("");
    setAmount("");
    setCategory("Прочее");
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    setOccurredOn(local.toISOString().slice(0, 10));
  };

  const submitManualTransaction = async () => {
    if ((!addFinanceTransaction && !updateFinanceTransaction) || savingFinance) return;

    setSavingFinance(true);
    const amountInEUR = toBaseEUR(Number(amount));
    const payload = {
      label: label.trim(),
      amount: amountInEUR,
      type: entryType,
      category: category.trim(),
      occurredOn,
      taskId: null,
    };
    const saved = editingId
      ? await updateFinanceTransaction?.(editingId, payload)
      : await addFinanceTransaction?.(payload);
    setSavingFinance(false);
    if (!saved) return;
    resetFinanceForm();
  };

  const beginEdit = (transaction: {
    id: string;
    label: string;
    amount: number;
    type: "income" | "expense";
    category: string;
    dateIso: string;
    source: "manual" | "stripe";
  }) => {
    if (transaction.source !== "manual") return;
    setEditingId(transaction.id);
    setEntryType(transaction.type);
    setLabel(transaction.label);
    setAmount(String(transaction.amount));
    setCategory(transaction.category);
    setOccurredOn(transaction.dateIso);
  };

  const finishDelete = async () => {
    if (!deletingId) return;
    await deleteFinanceTransaction?.(deletingId);
    setDeletingId(null);
    if (editingId === deletingId) resetFinanceForm();
  };

  return (
    <AppShell title="Финансы" subtitle="Доходы, расходы и структура по данным Supabase + Stripe">
      {isLoading && (
        <div className="panel mb-6 p-6 text-sm text-muted-foreground">
          Загружаю финансовые операции из Supabase…
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Доход" value={displayedIncome} tone="up" currency={currency} />
        <Kpi label="Расход" value={displayedExpense} tone="down" currency={currency} />
        <Kpi label="Чистыми" value={displayedBalance} tone="up" currency={currency} />
        <Kpi label="Активные подписки" value={activeSubscriptions.length} tone="up" />
        <Kpi label="Stripe транзакции" value={stripeTransactions.length} tone="up" />
      </div>

      <section className="panel mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Добавить операцию</h3>
            <p className="text-sm text-muted-foreground">
              Доходы и расходы считаются автоматически по всем сохранённым операциям.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-border bg-surface-2/60 px-3 py-1 text-xs text-muted-foreground">
              Баланс: {formatMoney(displayedBalance, currency)}
            </div>
            <div className="rounded-full border border-border bg-surface-2/60 px-3 py-1 text-xs text-muted-foreground">
              Курс: 1 EUR = {selectedRate.toLocaleString("ru-RU", { maximumFractionDigits: 4 })} {currency}
            </div>
            {ratesUpdatedAt && (
              <div className="rounded-full border border-border bg-surface-2/60 px-3 py-1 text-xs text-muted-foreground">
                Обновлено: {ratesUpdatedAt}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => void reloadRates()} disabled={ratesStatus === "loading"}>
              <RefreshCw className="mr-2 size-4" />
              {ratesStatus === "loading" ? "Обновляю курс..." : "Обновить курс"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[140px_1.2fr_0.8fr_0.9fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="finance-type">Тип</Label>
            <Select
              value={entryType}
              onValueChange={(value) => {
                const next = value === "expense" ? "expense" : "income";
                setEntryType(next);
                if (!category || category === "Прочее") {
                  setCategory(next === "income" ? "Доход" : "Расход");
                }
              }}
            >
              <SelectTrigger id="finance-type">
                <SelectValue placeholder="Тип операции" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Доход</SelectItem>
                <SelectItem value="expense">Расход</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-label">Название</Label>
            <Input
              id="finance-label"
              placeholder="Например, оплата от клиента"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-amount">Сумма</Label>
            <Input
              id="finance-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {amount
                ? `≈ ${formatMoney(convertCurrent(Number(amount), currency as DisplayCurrency, "EUR"), "EUR")} при сохранении`
                : "Введите сумму в выбранной валюте"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-category">Категория</Label>
            <Input
              id="finance-category"
              placeholder="Например, Продажи"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-date">Дата</Label>
            <Input
              id="finance-date"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </div>

          <div className="flex items-end">
            <div className="flex w-full gap-2">
              <Button
                className="flex-1"
                onClick={submitManualTransaction}
                disabled={savingFinance || !label.trim() || !amount || !category.trim()}
              >
                <Plus className="mr-2 size-4" />
                {savingFinance ? "Сохраняю..." : editingId ? "Сохранить" : "Добавить"}
              </Button>
              {editingId && (
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={resetFinanceForm}
                  disabled={savingFinance}
                >
                  Отмена
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <Button variant="outline" size="sm" onClick={() => setShowPaymentForm(true)}>
          <Plus className="size-4 mr-2" />
          Принять платеж
        </Button>
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
            currency={currency}
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
                <span>{formatMoney(toDisplayCurrency(c.value), currency)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">История операций</h3>
          <span className="text-xs text-muted-foreground">{allTransactions.length} операций</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Операция</th>
              <th className="px-4 py-3">Категория</th>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3 text-right">Сумма</th>
              <th className="px-4 py-3 text-right">Действия</th>
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
                  {formatMoney(toDisplayCurrency(t.amount), currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {t.source === "manual" ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => beginEdit(t)}>
                          Изменить
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-acc-4 hover:text-acc-4"
                          onClick={() => setDeletingId(t.id)}
                        >
                          <Trash2 className="mr-1.5 size-4" />
                          Удалить
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Только Stripe</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!allTransactions.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Операций пока нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <AlertDialog open={Boolean(deletingId)} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent className="border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить платеж?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите это удалить? Действие нельзя будет отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingFinance}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void finishDelete()}
              className="bg-acc-4 text-white hover:bg-acc-4/90"
              disabled={savingFinance}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  tone,
  currency = "EUR",
}: {
  label: string;
  value: number;
  tone: "up" | "down";
  currency?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{formatMoney(value, currency)}</p>
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
