import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  Ban,
  CheckCircle2,
  Clock3,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Send,
  X,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  WorkflowAgent,
  WorkflowDepartment,
  WorkflowProject,
  WorkflowTask,
  WorkflowTaskStatus,
} from "./types";

export type TaskTab = "all" | "queued" | "in_progress" | "approval_required" | "done";

const STATUS_LABEL: Record<WorkflowTaskStatus, string> = {
  planning: "Планируется",
  queued: "В очереди",
  in_progress: "В работе",
  paused: "Приостановлено",
  review: "На проверке",
  approval_required: "Требует утверждения",
  done: "Готово",
  blocked: "Заблокировано",
  revisions_requested: "Требуются правки",
  cancelled: "Отменено",
};

const PRIORITY_LABEL = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критичный",
};

function statusClass(status: WorkflowTaskStatus) {
  if (status === "done") return "text-badge-green";
  if (status === "in_progress" || status === "planning") return "text-badge-blue";
  if (status === "review") return "text-badge-purple";
  if (status === "paused") return "text-badge-gray";
  if (status === "approval_required") return "text-badge-yellow";
  if (status === "blocked" || status === "revisions_requested") return "text-badge-red";
  return "text-badge-blue";
}

function actionTypeBadge(action: "run" | "change" | null) {
  if (action === "run") return (
    <span className="rounded-full border px-2 py-1 text-[8px] bg-primary/20 text-primary">
      Run
    </span>
  );
  if (action === "change") return (
    <span className="rounded-full border px-2 py-1 text-[8px] bg-amber/20 text-amber">
      Change
    </span>
  );
  return null;
}

function dueLabel(value: string | null) {
  if (!value) return "Без срока";
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return `${sameDay ? "Сегодня, " : date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) + ", "}${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

export function TasksTable({
  tasks,
  projects,
  departments,
  agents,
  tab,
  search,
  selectedDepartmentId,
  onTabChange,
  onClearDepartment,
  onOpen,
  onStatusChange,
  onAssign,
  onRun,
  onApproval,
  onControl,
}: {
  tasks: WorkflowTask[];
  projects: WorkflowProject[];
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tab: TaskTab;
  search: string;
  selectedDepartmentId: string;
  onTabChange: (tab: TaskTab) => void;
  onClearDepartment: () => void;
  onOpen: (task: WorkflowTask) => void;
  onStatusChange: (task: WorkflowTask, status: WorkflowTaskStatus) => void;
  onAssign: (task: WorkflowTask, agentId: string) => void;
  onRun: (task: WorkflowTask) => void;
  onApproval: (task: WorkflowTask) => void;
  onControl: (task: WorkflowTask, action: "pause" | "resume" | "retry" | "cancel") => void;
}) {
  const [sort, setSort] = useState<"updated" | "due" | "priority">("updated");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const projectById = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const departmentById = new Map(departments.map((item) => [item.id, item]));
  const agentById = useMemo(() => new Map(agents.map((item) => [item.id, item])), [agents]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const values = tasks.filter((task) => {
      if (
        tab !== "all" &&
        (tab === "in_progress"
          ? !["planning", "in_progress", "paused", "review", "revisions_requested"].includes(
              task.status,
            )
          : task.status !== tab)
      )
        return false;
      if (selectedDepartmentId && task.department_id !== selectedDepartmentId) return false;
      if (!needle) return true;
      const project = task.project_id ? projectById.get(task.project_id)?.name : "";
      const agent = task.agent_id ? agentById.get(task.agent_id)?.role : "";
      return `${task.title} ${task.description} ${project} ${agent}`
        .toLocaleLowerCase()
        .includes(needle);
    });
    const priority = { low: 0, medium: 1, high: 2, critical: 3 };
    return [...values].sort((left, right) => {
      if (sort === "due") return (left.due_at ?? "9999").localeCompare(right.due_at ?? "9999");
      if (sort === "priority") return priority[right.priority] - priority[left.priority];
      return right.updated_at.localeCompare(left.updated_at);
    });
  }, [agentById, projectById, search, selectedDepartmentId, sort, tab, tasks]);
  const tabs: Array<{ value: TaskTab; label: string }> = [
    { value: "all", label: "Все" },
    { value: "queued", label: "В очереди" },
    { value: "in_progress", label: "В работе" },
    { value: "approval_required", label: "Требуют утверждения" },
    { value: "done", label: "Готово" },
  ];

  return (
    <section
      id="ai-workflow-tasks"
      className="rounded-2xl border border-border/50 bg-surface/88 backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Задачи на сегодня</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Рабочая очередь AI-команды в реальном времени
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedDepartmentId && (
            <button
              type="button"
              onClick={onClearDepartment}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 px-2.5 text-[10px] text-primary"
            >
              {departmentById.get(selectedDepartmentId)?.name}
              <X className="size-3" />
            </button>
          )}
          <label className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[10px] text-muted-foreground">
            <ArrowUpDown className="size-3.5" />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="bg-transparent text-foreground outline-none"
            >
              <option value="updated">По обновлению</option>
              <option value="due">По сроку</option>
              <option value="priority">По приоритету</option>
            </select>
          </label>
        </div>
        <div className="flex w-full gap-1 overflow-x-auto pt-1">
          {tabs.map((item) => {
            const count =
              item.value === "all"
                ? tasks.length
                : item.value === "in_progress"
                  ? tasks.filter((task) =>
                      [
                        "planning",
                        "in_progress",
                        "paused",
                        "review",
                        "revisions_requested",
                      ].includes(task.status),
                    ).length
                  : tasks.filter((task) => task.status === item.value).length;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onTabChange(item.value)}
                className={cn(
                  "whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[10px] transition",
                  tab === item.value
                    ? "border-primary/35 bg-primary/12 text-primary"
                    : "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                <span className="ml-1.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="grid min-h-48 place-items-center px-5 py-10 text-center">
          <div>
            <CheckCircle2 className="mx-auto size-8 text-primary/50" />
            <p className="mt-3 text-sm font-medium">Задач в этом фильтре нет</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Создайте новую задачу или измените фильтр.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все задачи"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(filtered.map((task) => task.id))
                            : new Set(),
                        )
                      }
                      className="accent-primary"
                    />
                  </th>
                  <th className="px-2 py-2.5">Задача</th>
                  <th className="px-2 py-2.5">Проект</th>
                  <th className="px-2 py-2.5">Отдел</th>
                  <th className="px-2 py-2.5">Агент</th>
                  <th className="px-2 py-2.5">Статус</th>
                  <th className="px-2 py-2.5">Тип</th>
                  <th className="px-2 py-2.5">Приоритет</th>
                  <th className="px-2 py-2.5">Срок</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filtered.map((task) => (
                  <tr key={task.id} className="transition hover:bg-white/[0.025]">
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать задачу ${task.title}`}
                        checked={selected.has(task.id)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(task.id);
                            else next.delete(task.id);
                            return next;
                          })
                        }
                        className="accent-primary"
                      />
                    </td>
                    <td className="max-w-64 px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => onOpen(task)}
                        className="max-w-full truncate text-left font-medium transition hover:text-primary"
                      >
                        {task.title}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className="rounded-md border border-border px-1.5 py-1 text-[9px]"
                        style={{
                          color: task.project_id
                            ? projectById.get(task.project_id)?.color
                            : undefined,
                        }}
                      >
                        {task.project_id
                          ? (projectById.get(task.project_id)?.name ?? "Проект")
                          : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-[10px] text-muted-foreground">
                      {task.department_id
                        ? (departmentById.get(task.department_id)?.name ?? "—")
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5">
                      <select
                        aria-label="Переназначить агента"
                        value={task.agent_id ?? ""}
                        onChange={(event) => onAssign(task, event.target.value)}
                        className="max-w-28 rounded-lg border border-transparent bg-transparent py-1 text-[10px] text-muted-foreground outline-none hover:border-border focus:border-primary/50"
                      >
                        <option value="">Не назначен</option>
                        {agents
                          .filter((agent) => agent.role !== "CEO")
                          .map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.role}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-2 py-2.5">
                      <select
                        aria-label="Изменить статус"
                        value={task.status}
                        onChange={(event) =>
                          onStatusChange(task, event.target.value as WorkflowTaskStatus)
                        }
                        className={cn(
                          "rounded-lg border border-transparent bg-transparent py-1 text-[10px] outline-none hover:border-border focus:border-primary/50",
                          statusClass(task.status),
                        )}
                      >
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2.5 text-[10px] text-muted-foreground">
                      {actionTypeBadge(task.action_type)}
                    </td>
                    <td className="px-2 py-2.5 text-[10px] text-muted-foreground">
                      {PRIORITY_LABEL[task.priority]}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-[10px] text-muted-foreground">
                      {dueLabel(task.due_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <TaskMenu
                        task={task}
                        onOpen={onOpen}
                        onRun={onRun}
                        onApproval={onApproval}
                        onControl={onControl}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-border/70 md:hidden">
            {filtered.map((task) => (
              <article key={task.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onOpen(task)}
                    className="text-left text-sm font-medium"
                  >
                    {task.title}
                  </button>
                  <TaskMenu
                    task={task}
                    onOpen={onOpen}
                    onRun={onRun}
                    onApproval={onApproval}
                    onControl={onControl}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span>
                    {task.project_id ? projectById.get(task.project_id)?.name : "Без проекта"}
                  </span>
                  <span>·</span>
                  <span>{task.agent_id ? agentById.get(task.agent_id)?.role : "Не назначен"}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <select
                    value={task.status}
                    onChange={(event) =>
                      onStatusChange(task, event.target.value as WorkflowTaskStatus)
                    }
                    className={cn(
                      "rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-[10px]",
                      statusClass(task.status),
                    )}
                  >
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock3 className="size-3" />
                    {dueLabel(task.due_at)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TaskMenu({
  task,
  onOpen,
  onRun,
  onApproval,
  onControl,
}: {
  task: WorkflowTask;
  onOpen: (task: WorkflowTask) => void;
  onRun: (task: WorkflowTask) => void;
  onApproval: (task: WorkflowTask) => void;
  onControl: (task: WorkflowTask, action: "pause" | "resume" | "retry" | "cancel") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Действия с задачей ${task.title}`}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-surface text-xs">
        <DropdownMenuItem onSelect={() => onOpen(task)}>Открыть задачу</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onRun(task)}>
          <Play className="size-3.5" /> Запустить
        </DropdownMenuItem>
        {task.status === "paused" ? (
          <DropdownMenuItem onSelect={() => onControl(task, "resume")}>
            <Play className="size-3.5" /> Возобновить
          </DropdownMenuItem>
        ) : !["done", "cancelled", "approval_required"].includes(task.status) ? (
          <DropdownMenuItem onSelect={() => onControl(task, "pause")}>
            <Pause className="size-3.5" /> Приостановить
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onApproval(task)}>
          <Send className="size-3.5" /> На утверждение
        </DropdownMenuItem>
        {["blocked", "revisions_requested"].includes(task.status) && (
          <DropdownMenuItem onSelect={() => onControl(task, "retry")}>
            <RotateCcw className="size-3.5" /> Повторить
          </DropdownMenuItem>
        )}
        {!["done", "cancelled"].includes(task.status) && (
          <DropdownMenuItem onSelect={() => onControl(task, "cancel")} className="text-red-300">
            <Ban className="size-3.5" /> Отменить
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
