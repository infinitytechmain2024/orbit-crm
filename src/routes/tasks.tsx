import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Columns3, List, Network, Plus, X } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { useCrm } from "@/lib/crm-store";
import { STATUS_LABEL, type Task, type TaskStatus } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Задачи и карта проектов — Orbit CRM" },
      {
        name: "description",
        content: "Канбан, список и интерактивная карта связей проектов с деталями задач в модальном окне.",
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

const COLUMNS: TaskStatus[] = ["inbox", "todo", "doing", "done"];

function TasksPage() {
  const { tasks, projects, moveTask, addTask } = useCrm();
  const [mode, setMode] = useState<"kanban" | "list" | "graph">("kanban");
  const [active, setActive] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);

  const current = active ? (tasks.find((t) => t.id === active.id) ?? null) : null;

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
          onClick={() => addTask({ title: "Новая задача", status: "inbox" })}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <Plus className="size-4" /> Задача
        </button>
      </div>

      {mode === "kanban" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col);
            return (
              <div
                key={col}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col);
                }}
                onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
                onDrop={() => {
                  if (dragId) moveTask(dragId, col);
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
                  {items.map((t) => (
                    <article
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setActive(t)}
                      className={cn(
                        "cursor-grab rounded-xl border border-border bg-surface-2/70 p-3 transition hover:border-primary/50 active:cursor-grabbing",
                        dragId === t.id && "opacity-40",
                      )}
                    >
                      <p className="text-sm">{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5",
                            t.priority === "high"
                              ? "bg-acc-4/15 text-acc-4"
                              : t.priority === "med"
                                ? "bg-acc-3/15 text-acc-3"
                                : "bg-acc-2/15 text-acc-2",
                          )}
                        >
                          {t.priority}
                        </span>
                        <span>{projects.find((p) => p.id === t.projectId)?.name}</span>
                        {t.due && <span className="ml-auto">{t.due}</span>}
                      </div>
                    </article>
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

      {mode === "list" && (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Задача</th>
                <th className="px-4 py-3">Проект</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Приоритет</th>
                <th className="px-4 py-3">Срок</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setActive(t)}
                  className="cursor-pointer transition hover:bg-surface-2/50"
                >
                  <td className="px-4 py-3">{t.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {projects.find((p) => p.id === t.projectId)?.name}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={t.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => moveTask(t.id, e.target.value as TaskStatus)}
                      className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c} value={c}>
                          {STATUS_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.priority}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.due ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "graph" && <ProjectGraph onPick={(t) => setActive(t)} />}

      {current && <TaskModal task={current} onClose={() => setActive(null)} />}
    </AppShell>
  );
}

function ProjectGraph({ onPick }: { onPick: (t: Task) => void }) {
  const { projects, tasks } = useCrm();
  const [sel, setSel] = useState<string>(projects[0]!.id);
  const pos = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const related = tasks.filter((t) => t.projectId === sel);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="panel relative h-[26rem] overflow-hidden">
        <svg className="absolute inset-0 size-full">
          {projects.flatMap((p) =>
            p.links.map((l) => {
              const b = pos[l];
              if (!b) return null;
              return (
                <line
                  key={`${p.id}-${l}`}
                  x1={`${p.x}%`}
                  y1={`${p.y}%`}
                  x2={`${b.x}%`}
                  y2={`${b.y}%`}
                  stroke="var(--acc-1)"
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  className="link-flow"
                />
              );
            }),
          )}
        </svg>
        {projects.map((p) => {
          const count = tasks.filter((t) => t.projectId === p.id && t.status !== "done").length;
          return (
            <button
              key={p.id}
              onClick={() => setSel(p.id)}
              style={{ left: `${p.x}%`, top: `${p.y}%`, borderColor: p.color }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface px-4 py-3 text-left shadow-lg transition hover:scale-105",
                sel === p.id && "ring-2 ring-primary",
              )}
            >
              <span className="block text-sm font-semibold">{p.name}</span>
              <span className="text-xs text-muted-foreground">{count} активных задач</span>
            </button>
          );
        })}
      </div>
      <div className="panel p-5">
        <h3 className="text-base font-semibold">{projects.find((p) => p.id === sel)?.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Задачи проекта</p>
        <div className="mt-4 space-y-2">
          {related.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-left text-sm transition hover:border-primary/50"
            >
              {t.title}
              <span className="block text-[11px] text-muted-foreground">{STATUS_LABEL[t.status]}</span>
            </button>
          ))}
          {!related.length && <p className="text-sm text-muted-foreground">Пока пусто.</p>}
        </div>
      </div>
    </div>
  );
}

function TaskModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { updateTask, removeTask, projects } = useCrm();
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl animate-in zoom-in-95"
      >
        <div className="flex items-start gap-4">
          <input
            value={task.title}
            onChange={(e) => updateTask(task.id, { title: e.target.value })}
            className="flex-1 bg-transparent font-display text-lg font-semibold outline-none"
          />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <textarea
          value={task.note ?? ""}
          onChange={(e) => updateTask(task.id, { note: e.target.value })}
          rows={4}
          placeholder="Заметки, контекст, ссылки…"
          className="mt-4 w-full resize-none rounded-xl border border-border bg-surface-2/60 p-3 text-sm outline-none focus:border-primary/60"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Статус">
            <select
              value={task.status}
              onChange={(e) => updateTask(task.id, { status: e.target.value as TaskStatus })}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            >
              {COLUMNS.map((c) => (
                <option key={c} value={c}>
                  {STATUS_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Приоритет">
            <select
              value={task.priority}
              onChange={(e) =>
                updateTask(task.id, { priority: e.target.value as Task["priority"] })
              }
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            >
              <option value="low">low</option>
              <option value="med">med</option>
              <option value="high">high</option>
            </select>
          </Field>
          <Field label="Проект">
            <select
              value={task.projectId}
              onChange={(e) => updateTask(task.id, { projectId: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-6 flex justify-between">
          <button
            onClick={() => {
              removeTask(task.id);
              onClose();
            }}
            className="rounded-xl border border-border px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10"
          >
            Удалить
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
