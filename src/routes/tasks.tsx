import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Columns3, List, Plus } from "lucide-react";
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
  const { tasks, projects, moveTask, isLoading, isMutating } = useCrm();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"kanban" | "list" | "calendar">("kanban");
  const [creating, setCreating] = useState<{ dueDate?: string } | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const visibleTasks = useMemo(() => tasks.filter((task) => !task.archivedAt), [tasks]);

  return (
    <AppShell
      title="Задачи и проекты"
      subtitle={
        mode === "calendar" ? "Календарь задач: месяц и неделя" : "Канбан, список и календарь задач"
      }
    >
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
    </AppShell>
  );
}
