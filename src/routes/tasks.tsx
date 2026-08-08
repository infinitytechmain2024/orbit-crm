import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Columns3, List, Network, Plus } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { TaskEditor } from "@/components/crm/TaskEditor";
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
      { title: "Задачи и карта проектов — Orbit CRM" },
      {
        name: "description",
        content: "Канбан, список и интерактивная карта связей проектов с полноценными задачами.",
      },
      { property: "og:title", content: "Задачи и карта проектов — Orbit CRM" },
      {
        property: "og:description",
        content: "Три режима работы: канбан-доска, список и граф связей проектов.",
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

function TasksPage() {
  const { tasks, projects, moveTask, isLoading, isMutating } = useCrm();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"kanban" | "list" | "graph">("kanban");
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const visibleTasks = useMemo(() => tasks.filter((task) => !task.archivedAt), [tasks]);

  return (
    <AppShell title="Задачи и проекты" subtitle="Канбан, список и карта связей">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
          {(
            [
              ["kanban", "Канбан", Columns3],
              ["list", "Список", List],
              ["graph", "Карта", Network],
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
          onClick={() => setCreating(true)}
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
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
                  "panel min-h-64 p-3 transition",
                  overCol === col && "border-primary/60 ring-1 ring-primary/40",
                )}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <p className="text-sm font-semibold">{STATUS_LABEL[col]}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((task) => (
                    <Link
                      key={task.id}
                      to="/tasks/$taskId"
                      params={{ taskId: task.id }}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      className={cn(
                        "block cursor-grab rounded-xl border border-border bg-surface-2/70 p-3 transition hover:border-primary/50 active:cursor-grabbing",
                        dragId === task.id && "opacity-40",
                      )}
                    >
                      <p className="line-clamp-2 text-sm">{task.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={cn("rounded-full px-2 py-0.5", priorityTone[task.priority])}
                        >
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <span className="truncate">
                          {projects.find((project) => project.id === task.projectId)?.name ??
                            "Без проекта"}
                        </span>
                        {task.due && <span className="ml-auto">{task.due}</span>}
                      </div>
                      {(task.checklistItems.length > 0 || task.files.length > 0) && (
                        <div className="mt-2 flex gap-2 text-[11px] text-muted-foreground">
                          {task.checklistItems.length > 0 && (
                            <span>
                              {task.checklistItems.filter((item) => item.completedAt).length}/
                              {task.checklistItems.length}
                            </span>
                          )}
                          {task.files.length > 0 && <span>{task.files.length} файл.</span>}
                        </div>
                      )}
                    </Link>
                  ))}
                  {!items.length && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
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
                  <th className="px-4 py-3">Чек-лист</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleTasks.map((task) => (
                  <tr key={task.id} className="transition hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: task.id }}
                        className="font-medium transition hover:text-primary"
                      >
                        {task.title}
                      </Link>
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
                      {PRIORITY_LABEL[task.priority]}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{task.due ?? "—"}</td>
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

      {!isLoading && mode === "graph" && <ProjectGraph tasks={visibleTasks} />}

      {creating && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setCreating(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
          >
            <TaskEditor
              task={null}
              onClose={() => setCreating(false)}
              onSaved={(task) => {
                setCreating(false);
                void navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
              }}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ProjectGraph({ tasks }: { tasks: Task[] }) {
  const { projects } = useCrm();
  const activeProjects = useMemo(
    () => projects.filter((project) => !project.archivedAt),
    [projects],
  );
  const [sel, setSel] = useState<string | null>(activeProjects[0]?.id ?? null);
  const pos = useMemo(
    () => Object.fromEntries(activeProjects.map((project) => [project.id, project])),
    [activeProjects],
  );
  const related = sel ? tasks.filter((task) => task.projectId === sel) : [];

  useEffect(() => {
    if (!activeProjects.length) {
      setSel(null);
      return;
    }

    if (!sel || !activeProjects.some((project) => project.id === sel)) {
      setSel(activeProjects[0]?.id ?? null);
    }
  }, [activeProjects, sel]);

  if (!activeProjects.length) {
    return <div className="panel p-6 text-sm text-muted-foreground">Проекты пока не созданы.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="panel relative h-[26rem] overflow-hidden">
        <svg className="absolute inset-0 size-full">
          {activeProjects.flatMap((project) =>
            project.links.map((linkId) => {
              const linkedProject = pos[linkId];
              if (!linkedProject) return null;
              return (
                <line
                  key={`${project.id}-${linkId}`}
                  x1={`${project.x}%`}
                  y1={`${project.y}%`}
                  x2={`${linkedProject.x}%`}
                  y2={`${linkedProject.y}%`}
                  stroke="var(--acc-1)"
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  className="link-flow"
                />
              );
            }),
          )}
        </svg>
        {activeProjects.map((project) => {
          const count = tasks.filter(
            (task) =>
              task.projectId === project.id &&
              task.status !== "completed" &&
              task.status !== "cancelled",
          ).length;
          return (
            <button
              key={project.id}
              onClick={() => setSel(project.id)}
              style={{ left: `${project.x}%`, top: `${project.y}%`, borderColor: project.color }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface px-4 py-3 text-left shadow-lg transition hover:scale-105",
                sel === project.id && "ring-2 ring-primary",
              )}
            >
              <span className="block text-sm font-semibold">{project.name}</span>
              <span className="text-xs text-muted-foreground">{count} активных задач</span>
            </button>
          );
        })}
      </div>
      <div className="panel p-5">
        <h3 className="text-base font-semibold">
          {activeProjects.find((project) => project.id === sel)?.name}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Задачи проекта</p>
        <div className="mt-4 space-y-2">
          {related.map((task) => (
            <Link
              key={task.id}
              to="/tasks/$taskId"
              params={{ taskId: task.id }}
              className="block w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-left text-sm transition hover:border-primary/50"
            >
              {task.title}
              <span className="block text-[11px] text-muted-foreground">
                {STATUS_LABEL[task.status]}
              </span>
            </Link>
          ))}
          {!related.length && <p className="text-sm text-muted-foreground">Пока пусто.</p>}
        </div>
      </div>
    </div>
  );
}
