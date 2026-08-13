import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import {
  ArrowUpRight,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Mail,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
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

type ParsedTask = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  assignee: string;
  checklist: string[];
  selected: boolean;
  expanded: boolean;
};

const prioTone: Record<Priority, string> = {
  high: "text-acc-4 bg-acc-4/12",
  med: "text-acc-3 bg-acc-3/12",
  low: "text-acc-2 bg-acc-2/12",
};

const prioLabel: Record<Priority, string> = {
  high: "Высокий",
  med: "Средний",
  low: "Низкий",
};

let taskCounter = 0;
function makeId() {
  return `parsed-${Date.now()}-${++taskCounter}`;
}

const AI_ANALYSIS_PROMPT = (
  text: string,
) => `Ты — ИИ-ассистент для управления задачами. Проанализируй следующую текстовую заметку пользователя и разбей её на отдельные задачи.

Заметка:
"""
${text}
"""

Инструкции:
- Выдели каждое отдельное поручение, идею, подзадачу или действие.
- Для каждой задачи определи: краткое название, подробное описание, приоритет (high/med/low), исполнителя (если упоминается человек), шаги выполнения (чек-лист, если уместно).
- Если в тексте упоминаются проекты или другие задачи — укажи это в описании.
- Если действие одно — создай одну задачу. Если несколько — создай несколько.
- Не создавай задачу "прочитать заметку" или подобную обобщённую — только конкретные действия.

Верни результат СТРОГО в формате JSON (массив объектов):
[
  {
    "title": "Краткое название задачи",
    "description": "Подробное описание",
    "priority": "high|med|low",
    "assignee": "Имя исполнителя или пустая строка",
    "checklist": ["Шаг 1", "Шаг 2"]
  }
]

Только JSON, без markdown, без комментариев.`;

function parseAiResponse(raw: string): Omit<ParsedTask, "id" | "selected" | "expanded">[] {
  let cleaned = raw.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  const arr = JSON.parse(cleaned);
  if (!Array.isArray(arr)) throw new Error("AI returned non-array");
  return arr.map((t: Record<string, unknown>) => ({
    title: String(t.title || "Без названия"),
    description: String(t.description || ""),
    priority: (["high", "med", "low"].includes(String(t.priority))
      ? t.priority
      : "low") as Priority,
    assignee: String(t.assignee || ""),
    checklist: Array.isArray(t.checklist) ? t.checklist.map(String) : [],
  }));
}

function Dashboard() {
  const { tasks, emails, txs, addTask } = useCrm();
  const [draft, setDraft] = useState("");
  const [stage, setStage] = useState<"idle" | "loading" | "preview">("idle");
  const [parsed, setParsed] = useState<ParsedTask[]>([]);
  const [adding, setAdding] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const open = tasks.filter((t) => t.status !== "completed" && !t.archivedAt);

  const analyze = useCallback(async () => {
    if (!draft.trim() || stage === "loading") return;
    setStage("loading");
    setParsed([]);
    setAiError(null);

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      // Fallback: simple split if no API key
      setTimeout(() => {
        const parts = draft
          .split(/[\n,;.]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 6);
        const tasks = (parts.length ? parts : [draft.trim()]).map((p, i) => ({
          id: makeId(),
          title: p.charAt(0).toUpperCase() + p.slice(1),
          description: "",
          priority: (i === 0 ? "high" : i === 1 ? "med" : "low") as Priority,
          assignee: "",
          checklist: [],
          selected: true,
          expanded: false,
        }));
        setParsed(tasks);
        setStage("preview");
      }, 1200);
      return;
    }

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: AI_ANALYSIS_PROMPT(draft) },
            { role: "user", content: draft },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error: ${errText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      if (!content) throw new Error("Пустой ответ от ИИ");

      const tasks = parseAiResponse(content).map((t) => ({
        ...t,
        id: makeId(),
        selected: true,
        expanded: false,
      }));

      setParsed(
        tasks.length > 0
          ? tasks
          : [
              {
                id: makeId(),
                title: draft.trim().charAt(0).toUpperCase() + draft.trim().slice(1),
                description: "",
                priority: "low" as Priority,
                assignee: "",
                checklist: [],
                selected: true,
                expanded: false,
              },
            ],
      );
      setStage("preview");
    } catch (err) {
      console.error("[Dashboard] AI analysis failed:", err);
      setAiError(
        err instanceof Error ? err.message : "Не удалось выполнить ИИ-разбор. Попробуйте ещё раз.",
      );
      setStage("idle");
    }
  }, [draft, stage]);

  const toggleTaskSelection = (id: string) => {
    setParsed((prev) => prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)));
  };

  const toggleTaskExpand = (id: string) => {
    setParsed((prev) => prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t)));
  };

  const updateTask = (id: string, patch: Partial<Omit<ParsedTask, "id">>) => {
    setParsed((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTask = (id: string) => {
    setParsed((prev) => prev.filter((t) => t.id !== id));
  };

  const addManualTask = () => {
    setParsed((prev) => [
      ...prev,
      {
        id: makeId(),
        title: "",
        description: "",
        priority: "low",
        assignee: "",
        checklist: [],
        selected: true,
        expanded: true,
      },
    ]);
  };

  const selectAll = () => {
    setParsed((prev) => prev.map((t) => ({ ...t, selected: true })));
  };

  const deselectAll = () => {
    setParsed((prev) => prev.map((t) => ({ ...t, selected: false })));
  };

  const sendToWork = async () => {
    const selected = parsed.filter((t) => t.selected && t.title.trim());
    if (!selected.length || adding) return;
    setAdding(true);

    const sourceNote = draft.trim();

    const results = await Promise.all(
      selected.map((p) =>
        addTask({
          title: p.title.trim(),
          description: p.description
            ? `${p.description}${sourceNote ? `\n\n---\nИсходная заметка:\n${sourceNote}` : ""}`
            : sourceNote || null,
          priority: p.priority,
          status: "backlog",
          assigneeId: null,
          tags: ["ии", "выгрузка-мыслей"],
          checklistTitles: p.checklist.length > 0 ? p.checklist : undefined,
        }),
      ),
    );

    if (results.every(Boolean)) {
      setParsed([]);
      setDraft("");
      setStage("idle");
    }
    setAdding(false);
  };

  const cancelPreview = () => {
    setParsed([]);
    setStage("idle");
  };

  const selectedCount = parsed.filter((t) => t.selected).length;

  return (
    <AppShell title="Дашборд" subtitle="Суббота, 8 августа · всё важное на одном экране">
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Main input section */}
        <section className="panel relative overflow-hidden p-6 xl:col-span-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> быстрый ввод
          </div>
          <h2 className="mt-2 text-2xl">
            Выгрузите мысли — <span className="text-gradient">ИИ разложит по полкам</span>
          </h2>

          {/* Textarea */}
          <QuickInputTextarea
            value={draft}
            onChange={setDraft}
            rows={4}
            placeholder="Например: позвонить Анне по договору, выставить счёт Nordwind, подготовить отчёт за июль"
            className="mt-4"
          />

          {stage !== "preview" && (
            <>
              {/* AI action button — prominent, centered */}
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => void analyze()}
                  disabled={!draft.trim() || stage === "loading"}
                  className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-acc-1 to-acc-2 px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/10 transition hover:opacity-90 hover:shadow-xl hover:shadow-primary/15 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Brain className={cn("size-4.5", stage === "loading" && "animate-pulse")} />
                  {stage === "loading" ? "ИИ разбирает…" : "Разобрать через ИИ"}
                </button>
              </div>

              {aiError && (
                <p className="mt-3 text-center text-xs text-destructive" role="alert">
                  {aiError}
                </p>
              )}
            </>
          )}

          {/* Loading skeleton */}
          {stage === "loading" && (
            <div className="mt-4 space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="shimmer h-12 rounded-xl bg-surface-2/70" />
              ))}
            </div>
          )}

          {/* Preview screen */}
          {stage === "preview" && parsed.length > 0 && (
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">ИИ распознал задачи</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Выберите, отредактируйте и отправьте в работу
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectAll}
                    className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                  >
                    Выбрать все
                  </button>
                  <button
                    onClick={deselectAll}
                    className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                  >
                    Снять все
                  </button>
                </div>
              </div>

              {/* Task cards */}
              <div className="space-y-2">
                {parsed.map((task) => (
                  <TaskPreviewCard
                    key={task.id}
                    task={task}
                    onToggleSelect={() => toggleTaskSelection(task.id)}
                    onToggleExpand={() => toggleTaskExpand(task.id)}
                    onUpdate={(patch) => updateTask(task.id, patch)}
                    onRemove={() => removeTask(task.id)}
                  />
                ))}
              </div>

              {/* Add manual task */}
              <button
                onClick={addManualTask}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              >
                <Plus className="size-4" /> Добавить задачу вручную
              </button>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={cancelPreview}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  Назад
                </button>
                <button
                  onClick={() => void sendToWork()}
                  disabled={adding || selectedCount === 0}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="size-4" />
                  {adding
                    ? "Отправляю…"
                    : `Отправить ${selectedCount} ${selectedCount === 1 ? "задачу" : selectedCount < 5 ? "задачи" : "задач"} в работу`}
                </button>
              </div>
            </div>
          )}

          {/* Empty state after preview sends */}
          {stage === "preview" && parsed.length === 0 && (
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Все задачи удалены. Нажмите "Назад" чтобы вернуться.
            </div>
          )}
        </section>

        {/* Sidebar metrics */}
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

        {/* Upcoming tasks */}
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

        {/* Recent emails */}
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

/* ─── Task Preview Card ─── */

function TaskPreviewCard({
  task,
  onToggleSelect,
  onToggleExpand,
  onUpdate,
  onRemove,
}: {
  task: ParsedTask;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<Omit<ParsedTask, "id">>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description);

  const saveEdits = () => {
    onUpdate({ title: titleDraft, description: descDraft });
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface-2/70 transition-all",
        task.selected ? "border-primary/30 bg-primary/5" : "border-border opacity-60",
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-md border transition-all",
            task.selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-surface-1 text-transparent hover:border-primary/40",
          )}
          aria-label={task.selected ? "Снять выделение" : "Выбрать задачу"}
        >
          {task.selected && <Check className="size-3" />}
        </button>

        {/* Drag handle (visual only) */}
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40" />

        {/* Title / edit mode */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveEdits}
              onKeyDown={(e) => e.key === "Enter" && saveEdits()}
              autoFocus
              className="w-full rounded-lg border border-primary/40 bg-surface-1 px-2 py-1 text-sm outline-none"
              placeholder="Название задачи"
            />
          ) : (
            <p className="truncate text-sm font-medium" onDoubleClick={() => setEditing(true)}>
              {task.title || "Без названия"}
            </p>
          )}
        </div>

        {/* Priority badge */}
        <span
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", prioTone[task.priority])}
        >
          {prioLabel[task.priority]}
        </span>

        {/* Actions */}
        <button
          onClick={() => setEditing(!editing)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-3 hover:text-foreground"
          aria-label="Редактировать"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={onRemove}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          aria-label="Удалить"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          onClick={onToggleExpand}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-surface-3 hover:text-foreground"
          aria-label={task.expanded ? "Свернуть" : "Развернуть"}
        >
          {task.expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      </div>

      {/* Expanded details */}
      {task.expanded && (
        <div className="border-t border-border/50 px-4 pb-3 pt-3 space-y-3">
          {/* Description */}
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Описание
            </label>
            <textarea
              value={task.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              rows={2}
              placeholder="Подробное описание задачи…"
              className="w-full resize-none rounded-lg border border-border bg-surface-1 p-2 text-sm outline-none transition focus:border-primary/40"
            />
          </div>

          {/* Priority + Assignee row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                Приоритет
              </label>
              <div className="flex gap-1.5">
                {(["high", "med", "low"] as Priority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => onUpdate({ priority: p })}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[11px] transition",
                      task.priority === p
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-primary/30",
                    )}
                  >
                    {prioLabel[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                Исполнитель
              </label>
              <input
                value={task.assignee}
                onChange={(e) => onUpdate({ assignee: e.target.value })}
                placeholder="Кто выполняет"
                className="w-full rounded-lg border border-border bg-surface-1 px-2 py-1 text-sm outline-none transition focus:border-primary/40"
              />
            </div>
          </div>

          {/* Checklist */}
          {task.checklist.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                Шаги выполнения
              </label>
              <div className="space-y-1">
                {task.checklist.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="grid size-4 shrink-0 place-items-center rounded border border-border text-[10px]">
                      {i + 1}
                    </span>
                    {step}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Metric card ─── */

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
