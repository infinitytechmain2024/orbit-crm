import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Calendar as CalendarIcon,
  Clock3,
  Columns3,
  FilePenLine,
  List,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { TaskCalendar } from "@/components/crm/TaskCalendar";
import { TaskEditor } from "@/components/crm/TaskEditor";
import { Progress } from "@/components/ui/progress";
import { useCrm } from "@/lib/crm-store";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  type Priority,
  type Task,
  type TaskStatus,
} from "@/lib/crm-data";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type DevIdea = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type ParsedIdeaTask = {
  title: string;
  description: string;
  priority: "high" | "med" | "low";
  assignee: string;
  checklist: string[];
  target_role: string | null;
  dispatch_to_workflow: boolean;
  project_hint: string | null;
};

type AiAnalyzeResponse = {
  tasks: ParsedIdeaTask[];
  provider: string;
  model: string;
  elapsed_ms?: number | null;
};

const IDEAS_STORAGE_KEY = "orbit-dev-ideas";
const IDEA_COUNTER_KEY = "orbit-dev-idea-counter";

function makeIdeaId() {
  if (typeof window === "undefined") return `idea-${Date.now()}`;
  const next = Number(window.localStorage.getItem(IDEA_COUNTER_KEY) ?? "0") + 1;
  window.localStorage.setItem(IDEA_COUNTER_KEY, String(next));
  return `idea-${Date.now()}-${next}`;
}

function readIdeasFromStorage(): DevIdea[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(IDEAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DevIdea[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatIdeaDate(value: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Задачи и проекты — Orbit CRM" },
      {
        name: "description",
        content: "Канбан, список и календарь задач с полноценными проектами.",
      },
      { property: "og:title", content: "Задачи и проекты — Orbit CRM" },
      {
        property: "og:description",
        content: "Режимы работы: канбан-доска, список и календарь задач.",
      },
    ],
  }),
  component: TasksPage,
});

const priorityTone: Record<Priority, string> = {
  high: "bg-acc-4/15 text-acc-4",
  med: "bg-acc-3/15 text-acc-3",
  low: "bg-acc-2/15 text-acc-2",
};

const CURRENCY_FLAGS: Record<string, string> = {
  EUR: "🇪🇺",
  USD: "🇺🇸",
  GBP: "🇬🇧",
  CHF: "🇨🇭",
  PLN: "🇵🇱",
  TRY: "🇹🇷",
  UAH: "🇺🇦",
};

function TasksPage() {
  const { tasks, projects, moveTask, isLoading, isMutating, addTask, organization } = useCrm();
  const { session } = useAuth();
  const [mode, setMode] = useState<"kanban" | "list" | "calendar">("kanban");
  const [creating, setCreating] = useState<{ dueDate?: string } | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [ideas, setIdeas] = useState<DevIdea[]>([]);
  const [ideaDraft, setIdeaDraft] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [editingIdea, setEditingIdea] = useState<DevIdea | null>(null);
  const [ideaBusyId, setIdeaBusyId] = useState<string | null>(null);
  const [ideaMessage, setIdeaMessage] = useState<string | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const visibleTasks = useMemo(() => tasks.filter((task) => !task.archivedAt), [tasks]);

  useEffect(() => {
    setIdeas(readIdeasFromStorage());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(IDEAS_STORAGE_KEY, JSON.stringify(ideas));
  }, [ideas]);

  const addIdea = useCallback(() => {
    const body = ideaDraft.trim();
    if (!body) return;
    const now = new Date().toISOString();
    setIdeas((current) => [
      {
        id: makeIdeaId(),
        title: ideaTitle.trim() || body.split("\n")[0].slice(0, 80) || "Идея для разработки",
        body,
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ]);
    setIdeaDraft("");
    setIdeaTitle("");
    setIdeaMessage("Идея сохранена");
    setTimeout(() => setIdeaMessage(null), 1800);
  }, [ideaDraft, ideaTitle]);

  const updateIdea = useCallback((id: string, patch: Partial<Pick<DevIdea, "title" | "body">>) => {
    setIdeas((current) =>
      current.map((idea) =>
        idea.id === id
          ? {
              ...idea,
              ...patch,
              updatedAt: new Date().toISOString(),
              title: patch.title?.trim() || idea.title,
              body: patch.body?.trim() || idea.body,
            }
          : idea,
      ),
    );
  }, []);

  const deleteIdea = useCallback((id: string) => {
    setIdeas((current) => current.filter((idea) => idea.id !== id));
  }, []);

  const resolveProjectId = useCallback(
    (hint: string | null) => {
      if (!hint) return null;
      const lower = hint.toLowerCase().trim();
      const found = projects.find(
        (project) =>
          project.name.toLowerCase().includes(lower) || lower.includes(project.name.toLowerCase()),
      );
      return found?.id ?? null;
    },
    [projects],
  );

  const dispatchIdeaToWorkflow = useCallback(
    async (idea: DevIdea) => {
      if (!session?.access_token) {
        setIdeaError("Нет активной сессии для отправки в AI Workflow");
        return;
      }

      setIdeaBusyId(idea.id);
      setIdeaError(null);
      setIdeaMessage("Разбираю идею и готовлю отправку…");

      try {
        const response = await fetch("/api/ai/analyze-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `${idea.title}\n\n${idea.body}` }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          throw new Error(errData?.error || `Server error ${response.status}`);
        }

        const data: AiAnalyzeResponse = await response.json();
        const sourceNote = `${idea.title}\n\n${idea.body}`;
        const created: Array<{
          task: { id: string; title: string; description: string | null };
          item: ParsedIdeaTask;
        }> = [];
        if (!organization) throw new Error("Не найдена активная организация");

        for (const item of data.tasks) {
          const task = await addTask({
            title: item.title.trim(),
            description: item.description
              ? `${item.description}\n\n---\nИсходная идея:\n${sourceNote}`
              : sourceNote,
            priority: item.priority,
            status: "backlog",
            assigneeId: null,
            tags: ["idea", "development"],
            checklistTitles: item.checklist.length > 0 ? item.checklist : undefined,
            source: "ai_brain_dump",
            workflowStatus: item.dispatch_to_workflow ? "pending_dispatch" : "manual",
            targetRole: item.target_role,
            dispatchToWorkflow: item.dispatch_to_workflow,
            projectId: resolveProjectId(item.project_hint),
          });
          if (task) {
            created.push({
              task: { id: task.id, title: task.title, description: task.description },
              item,
            });
          }
        }

        if (!created.length) {
          throw new Error("AI не вернул задач для создания");
        }

        const dispatchable = created.filter((entry) => entry.item.dispatch_to_workflow);
        if (dispatchable.length) {
          const dispatchResults = await Promise.all(
            dispatchable.map(async (entry) => {
              const res = await fetch("/api/backend/api/ai-workflow/tasks", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                  organization_id: organization.id,
                  title: entry.item.title.trim(),
                  description: entry.item.description || "",
                  original_request: sourceNote,
                  source: "ai_brain_dump",
                  source_entity_type: "crm_task",
                  source_entity_id: entry.task.id,
                  priority:
                    entry.item.priority === "high"
                      ? "high"
                      : entry.item.priority === "med"
                        ? "medium"
                        : "low",
                  auto_assign: true,
                  project_hint: entry.item.project_hint,
                  target_role: entry.item.target_role,
                }),
              });
              if (!res.ok) {
                return { ok: false, error: await res.text() };
              }
              return { ok: true };
            }),
          );
          const failed = dispatchResults.find((result) => !result.ok);
          if (failed && "error" in failed) {
            throw new Error(`AI Workflow: ${failed.error}`);
          }
        }

        setIdeaMessage(
          `Готово: ${created.length} задач${created.length === 1 ? "а" : "и"} отправлено`,
        );
        setTimeout(() => setIdeaMessage(null), 2800);
      } catch (error) {
        setIdeaError(
          error instanceof Error ? error.message : "Не удалось отправить идею в AI Workflow",
        );
      } finally {
        setIdeaBusyId(null);
      }
    },
    [addTask, organization, resolveProjectId, session?.access_token],
  );

  return (
    <AppShell
      title="Задачи и проекты"
      subtitle={
        mode === "calendar" ? "Календарь задач: месяц и неделя" : "Канбан, список и календарь задач"
      }
    >
      <section className="panel mb-6 overflow-hidden p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-primary">
              <Sparkles className="size-3.5" />
              Идеи для разработки
            </div>
            <h2 className="mt-3 text-lg font-semibold">
              Заметки, которые можно потом превратить в работу
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Можно накидывать мысли голосом или текстом, возвращаться к ним позже, редактировать и
              сразу отправлять в AI Workflow для разбивки на задачи.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Clock3 className="size-4" />
              {ideas.length} заметок
            </div>
            <div className="mt-1 text-xs">Локально сохраняются в этом браузере</div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <div className="rounded-2xl border border-border bg-surface-2/60 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Новая идея</p>
              <button
                onClick={addIdea}
                disabled={!ideaDraft.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                <Plus className="size-3.5" />
                Сохранить
              </button>
            </div>
            <input
              value={ideaTitle}
              onChange={(event) => setIdeaTitle(event.target.value)}
              placeholder="Заголовок идеи, например: улучшить онбординг"
              className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary/60"
            />
            <textarea
              value={ideaDraft}
              onChange={(event) => setIdeaDraft(event.target.value)}
              rows={6}
              placeholder="Записывайте здесь заметку, мысль, пожелание или кусок будущей фичи…"
              className="mt-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary/60"
            />
            {ideaMessage && <p className="mt-2 text-xs text-emerald-400">{ideaMessage}</p>}
            {ideaError && <p className="mt-2 text-xs text-red-400">{ideaError}</p>}
          </div>

          <div className="rounded-2xl border border-border bg-surface-2/60 p-4">
            <p className="text-sm font-medium">Список идей</p>
            <div className="mt-3 space-y-3">
              {ideas.length === 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  Пока нет сохранённых идей. Можно просто набросать первую мысль слева.
                </div>
              )}
              {ideas.map((idea) => (
                <button
                  key={idea.id}
                  type="button"
                  onClick={() => setEditingIdea(idea)}
                  className="group block w-full rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-primary/40 hover:bg-surface/90"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{idea.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{idea.body}</p>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <span>{formatIdeaDate(idea.updatedAt)}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5">
                      <FilePenLine className="size-3" />
                      Открыть / редактировать
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
          {(
            [
              ["kanban", "Канбан", Columns3],
              ["list", "Список", List],
              ["calendar", "Календарь", CalendarIcon],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition",
                mode === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreating({})}
          disabled={isLoading || isMutating}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
        >
          <Plus className="size-4" /> Задача
        </button>
      </div>

      {isLoading && (
        <div className="panel p-6 text-sm text-muted-foreground">Загружаю задачи из Supabase…</div>
      )}

      {!isLoading && mode === "kanban" && (
        <div className="flex flex-col gap-5 overflow-x-auto pb-4 md:flex-row w-full items-start">
          {TASK_STATUSES.map((col) => {
            const items = visibleTasks.filter((task) => task.status === col);
            return (
              <div
                key={col}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverCol(col);
                }}
                onDragLeave={() => setOverCol((current) => (current === col ? null : current))}
                onDrop={() => {
                  if (dragId) void moveTask(dragId, col);
                  setDragId(null);
                  setOverCol(null);
                }}
                className={cn(
                  "panel min-h-72 w-full flex-1 min-w-[280px] sm:min-w-[300px] lg:min-w-[320px] p-4 transition",
                  overCol === col && "border-primary/60 ring-1 ring-primary/40",
                )}
              >
                <div className="mb-4 flex items-center justify-between px-1">
                  <p className="text-sm font-semibold">{STATUS_LABEL[col]}</p>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {items.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => {
                        setDragId(task.id);
                        setIsDragging(true);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setTimeout(() => setIsDragging(false), 150);
                      }}
                      onClick={() => {
                        if (!isDragging) {
                          setEditingTask(task);
                        }
                      }}
                      className={cn(
                        "block cursor-pointer rounded-xl border border-border bg-surface-2/70 p-4 transition hover:border-primary/50 active:cursor-grabbing shadow-sm hover:shadow-md",
                        dragId === task.id && "opacity-40",
                      )}
                    >
                      <p className="line-clamp-3 text-sm font-medium leading-snug">{task.title}</p>
                      <div className="mt-2">
                        <Progress value={task.progress} className="h-1.5" />
                        <p className="mt-1 text-[10px] text-muted-foreground">{task.progress}%</p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 font-medium text-[11px]",
                            priorityTone[task.priority],
                          )}
                        >
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <span className="truncate max-w-[180px]">
                          {projects.find((project) => project.id === task.projectId)?.name ??
                            "Без проекта"}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
                          <span>{CURRENCY_FLAGS[task.currency?.toUpperCase?.() ?? ""] ?? "¤"}</span>
                          <span>{task.currency?.toUpperCase?.() ?? "—"}</span>
                        </span>
                        {task.due && <span className="ml-auto text-[11px]">{task.due}</span>}
                      </div>
                      {(task.checklistItems.length > 0 || task.files.length > 0) && (
                        <div className="mt-2.5 flex items-center gap-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                          {task.checklistItems.length > 0 && (
                            <span>
                              Чек-лист:{" "}
                              {task.checklistItems.filter((item) => item.completedAt).length}/
                              {task.checklistItems.length}
                            </span>
                          )}
                          {task.files.length > 0 && <span>Файлов: {task.files.length}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                  {!items.length && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                      Перетащите карточку сюда
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && mode === "list" && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Задача</th>
                  <th className="px-4 py-3">Проект</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Исполнитель</th>
                  <th className="px-4 py-3">Приоритет</th>
                  <th className="px-4 py-3">Срок</th>
                  <th className="px-4 py-3">Прогресс</th>
                  <th className="px-4 py-3">Чек-лист</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleTasks.map((task) => (
                  <tr key={task.id} className="transition hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setEditingTask(task)}
                        className="text-left font-medium transition hover:text-primary"
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {projects.find((project) => project.id === task.projectId)?.name ??
                        "Без проекта"}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={task.status}
                        disabled={isMutating}
                        onChange={(event) =>
                          void moveTask(task.id, event.target.value as TaskStatus)
                        }
                        className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
                      >
                        {TASK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABEL[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.assigneeId ? task.assigneeId.slice(0, 8) : "Не назначен"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>{PRIORITY_LABEL[task.priority]}</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
                          <span>{CURRENCY_FLAGS[task.currency?.toUpperCase?.() ?? ""] ?? "¤"}</span>
                          <span>{task.currency?.toUpperCase?.() ?? "—"}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{task.due ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={task.progress} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground">{task.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.checklistItems.length
                        ? `${task.checklistItems.filter((item) => item.completedAt).length}/${task.checklistItems.length}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isLoading && mode === "calendar" && (
        <TaskCalendar
          onCreateDate={(dueDate) => setCreating({ dueDate })}
          onSelectTask={(task) => setEditingTask(task)}
        />
      )}

      {creating !== null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setCreating(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
          >
            <TaskEditor
              task={null}
              {...(creating.dueDate ? { initialDueDate: creating.dueDate } : {})}
              onClose={() => setCreating(null)}
              onSaved={(task) => {
                setCreating(null);
                setEditingTask(task);
              }}
            />
          </div>
        </div>
      )}

      {editingTask !== null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setEditingTask(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
          >
            <TaskEditor
              task={editingTask}
              onClose={() => setEditingTask(null)}
              onSaved={() => setEditingTask(null)}
              onDeleted={() => setEditingTask(null)}
            />
          </div>
        </div>
      )}

      {editingIdea !== null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setEditingIdea(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Идея для разработки
                </p>
                <h3 className="mt-1 text-lg font-semibold">Открыть, поправить, отправить дальше</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => deleteIdea(editingIdea.id)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                  Удалить
                </button>
                <button
                  type="button"
                  onClick={() => void dispatchIdeaToWorkflow(editingIdea)}
                  disabled={ideaBusyId === editingIdea.id}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
                >
                  <Workflow className="size-4" />
                  {ideaBusyId === editingIdea.id ? "Отправляю…" : "В AI Workflow"}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <input
                value={editingIdea.title}
                onChange={(event) =>
                  setEditingIdea((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
              />
              <textarea
                value={editingIdea.body}
                onChange={(event) =>
                  setEditingIdea((current) =>
                    current ? { ...current, body: event.target.value } : current,
                  )
                }
                rows={10}
                className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    updateIdea(editingIdea.id, {
                      title: editingIdea.title,
                      body: editingIdea.body,
                    });
                    setIdeaMessage("Идея обновлена");
                    setTimeout(() => setIdeaMessage(null), 1800);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  <FilePenLine className="size-4" />
                  Сохранить изменения
                </button>
                <span className="text-xs text-muted-foreground">
                  Создано: {formatIdeaDate(editingIdea.createdAt)} · Обновлено:{" "}
                  {formatIdeaDate(editingIdea.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
