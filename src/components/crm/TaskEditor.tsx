import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  Check,
  Clock,
  Download,
  ExternalLink,
  FileUp,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCrm } from "@/lib/crm-store";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type OrganizationMember,
  type Priority,
  type Project,
  type Task,
  type TaskInput,
  type TaskLabel,
  type TaskPatch,
  type TaskStatus,
} from "@/lib/crm-data";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/api-client";
import { Progress } from "@/components/ui/progress";

const CURRENCY_FLAGS: Record<string, string> = {
  EUR: "🇪🇺",
  USD: "🇺🇸",
  GBP: "🇬🇧",
  CHF: "🇨🇭",
  PLN: "🇵🇱",
  TRY: "🇹🇷",
  UAH: "🇺🇦",
};

type TaskAssistObjective = "plan_task" | "summarize_history" | "qa_review";

type TaskDraft = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  projectId: string;
  parentTaskId: string;
  startDate: string;
  dueDate: string;
  estimatedMinutes: string;
  actualMinutes: string;
  assigneeId: string;
  expectedRevenue: string;
  internalCost: string;
  currency: string;
  labelIds: string[];
  watcherIds: string[];
  newLabels: string;
  progress: number;
};

type TaskEditorProps = {
  task: Task | null;
  onClose?: () => void;
  onSaved?: (task: Task) => void;
  onDeleted?: () => void;
  initialStartDate?: string;
  initialDueDate?: string;
};

function memberLabel(member: OrganizationMember): string {
  return member.fullName || member.email || member.userId.slice(0, 8);
}

function projectLabel(projects: Project[], projectId: string | null): string {
  if (!projectId) return "Без проекта";
  return projects.find((project) => project.id === projectId)?.name ?? "Без проекта";
}

function moneyInputValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function createDraft(
  task: Task | null,
  initial: { startDate: string | undefined; dueDate: string | undefined },
): TaskDraft {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? "backlog",
    priority: task?.priority ?? "med",
    projectId: task?.projectId ?? "",
    parentTaskId: task?.parentTaskId ?? "",
    startDate: task?.startDate ?? initial?.startDate ?? "",
    dueDate: task?.dueDate ?? initial?.dueDate ?? "",
    estimatedMinutes:
      task?.estimatedMinutes === null || task?.estimatedMinutes === undefined
        ? ""
        : String(task.estimatedMinutes),
    actualMinutes: task ? String(task.actualMinutes) : "0",
    assigneeId: task?.assigneeId ?? "",
    expectedRevenue: moneyInputValue(task?.expectedRevenue ?? null),
    internalCost: moneyInputValue(task?.internalCost ?? null),
    currency: task?.currency ?? "EUR",
    labelIds: task?.labels.map((label) => label.id) ?? [],
    watcherIds: task?.watcherIds ?? [],
    newLabels: "",
    progress: task?.progress ?? (task ? 0 : 5),
  };
}

function parseOptionalInteger(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Поле "${label}" должно быть целым положительным числом.`);
  }
  return parsed;
}

function parseRequiredInteger(value: string, label: string): number {
  return parseOptionalInteger(value, label) ?? 0;
}

function parseOptionalMoney(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(`Поле "${label}" должно быть корректным числом.`);
  }
  return parsed;
}

function splitLabels(value: string): string[] {
  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function descendantIds(taskId: string, tasks: Task[]): Set<string> {
  const result = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    tasks.forEach((candidate) => {
      if (candidate.parentTaskId === current && !result.has(candidate.id)) {
        result.add(candidate.id);
        queue.push(candidate.id);
      }
    });
  }
  return result;
}

export function TaskEditor({
  task,
  onClose,
  onSaved,
  onDeleted,
  initialStartDate,
  initialDueDate,
}: TaskEditorProps) {
  const {
    addTask,
    updateTask,
    archiveTask,
    removeTask,
    addChecklistItem,
    updateChecklistItem,
    deleteChecklistItem,
    addTaskComment,
    uploadTaskFile,
    openTaskFile,
    tasks,
    projects,
    members,
    taskLabels,
    isMutating,
    organization,
  } = useCrm();
  const isCreating = !task;
  const [draft, setDraft] = useState<TaskDraft>(() =>
    createDraft(task, { startDate: initialStartDate, dueDate: initialDueDate }),
  );
  const [checklistTitle, setChecklistTitle] = useState("");
  const [pendingChecklist, setPendingChecklist] = useState<string[]>([]);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [pendingSubtasks, setPendingSubtasks] = useState<string[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<TaskAssistObjective | null>(null);
  const [aiResult, setAiResult] = useState<{
    objective: TaskAssistObjective;
    content: string;
  } | null>(null);

  useEffect(() => {
    setDraft(createDraft(task, { startDate: initialStartDate, dueDate: initialDueDate }));
    setChecklistTitle("");
    setPendingChecklist([]);
    setSubtaskTitle("");
    setPendingSubtasks([]);
    setCommentBody("");
    setPendingFiles([]);
    setLocalError(null);
    setAiBusy(null);
    setAiResult(null);
  }, [task, initialStartDate, initialDueDate]);

  const activeProjects = projects.filter(
    (project) => !project.archivedAt || project.id === task?.projectId,
  );
  const blockedParentIds = useMemo(
    () => (task ? descendantIds(task.id, tasks) : new Set<string>()),
    [task, tasks],
  );
  const parentOptions = tasks.filter(
    (candidate) =>
      !candidate.archivedAt && candidate.id !== task?.id && !blockedParentIds.has(candidate.id),
  );
  const childTasks = task ? tasks.filter((candidate) => candidate.parentTaskId === task.id) : [];
  const cannotDelete = Boolean(task && (childTasks.length > 0 || task.financeOperationsCount > 0));

  const setField = <Key extends keyof TaskDraft>(key: Key, value: TaskDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleId = (key: "labelIds" | "watcherIds", id: string) => {
    setDraft((current) => {
      const selected = current[key];
      return {
        ...current,
        [key]: selected.includes(id)
          ? selected.filter((selectedId) => selectedId !== id)
          : [...selected, id],
      };
    });
  };

  const buildInput = (): TaskInput | TaskPatch => {
    const title = draft.title.trim();
    if (!title) throw new Error("Название задачи обязательно.");
    if (draft.startDate && draft.dueDate && draft.dueDate < draft.startDate) {
      throw new Error("Дедлайн не может быть раньше даты начала.");
    }

    const currency = draft.currency.trim().toUpperCase() || "EUR";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("Валюта должна быть трёхбуквенным ISO-кодом.");
    }

    return {
      actualMinutes: parseRequiredInteger(draft.actualMinutes, "Фактическое время"),
      assigneeId: draft.assigneeId || null,
      assigneeIds: draft.assigneeId ? [draft.assigneeId] : [],
      currency,
      description: draft.description.trim() || null,
      dueDate: draft.dueDate || null,
      estimatedMinutes: parseOptionalInteger(draft.estimatedMinutes, "Оценка"),
      expectedRevenue: parseOptionalMoney(draft.expectedRevenue, "Ожидаемый доход"),
      internalCost: parseOptionalMoney(draft.internalCost, "Внутренняя стоимость"),
      labelIds: draft.labelIds,
      newLabelNames: splitLabels(draft.newLabels),
      parentTaskId: draft.parentTaskId || null,
      priority: draft.priority,
      progress: draft.progress,
      projectId: draft.projectId || null,
      startDate: draft.startDate || null,
      status: draft.status,
      title,
      watcherIds: draft.watcherIds,
      ...(isCreating
        ? {
            checklistTitles: pendingChecklist,
            subtaskTitles: pendingSubtasks,
          }
        : {}),
    };
  };

  const save = async () => {
    if (busy || isMutating) return;

    setLocalError(null);
    let input: TaskInput | TaskPatch;
    try {
      input = buildInput();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Проверьте поля задачи.");
      return;
    }

    setBusy(true);
    const saved = task
      ? await updateTask(task.id, input as TaskPatch)
      : await addTask(input as TaskInput);

    if (saved && isCreating) {
      for (const file of pendingFiles) {
        await uploadTaskFile(saved.id, file);
      }
      if (commentBody.trim()) {
        await addTaskComment(saved.id, commentBody);
      }
    }

    setBusy(false);
    if (saved) onSaved?.(saved);
  };

  const addChecklist = async () => {
    const title = checklistTitle.trim();
    if (!title || busy || isMutating) return;

    if (isCreating) {
      setPendingChecklist((current) => [...current, title]);
      setChecklistTitle("");
      return;
    }

    setBusy(true);
    await addChecklistItem(task.id, title);
    setChecklistTitle("");
    setBusy(false);
  };

  const addSubtask = async () => {
    const title = subtaskTitle.trim();
    if (!title || busy || isMutating) return;

    if (isCreating) {
      setPendingSubtasks((current) => [...current, title]);
      setSubtaskTitle("");
      return;
    }

    setBusy(true);
    const created = await addTask({
      title,
      parentTaskId: task.id,
      projectId: task.projectId,
      priority: task.priority,
      status: "backlog",
    });
    setSubtaskTitle("");
    setBusy(false);
    if (created) onSaved?.(task);
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!body || busy || isMutating || !task) return;

    setBusy(true);
    await addTaskComment(task.id, body);
    setCommentBody("");
    setBusy(false);
  };

  const uploadFiles = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;

    if (isCreating) {
      setPendingFiles((current) => [...current, ...selectedFiles]);
      return;
    }

    setBusy(true);
    for (const file of selectedFiles) {
      await uploadTaskFile(task.id, file);
    }
    setBusy(false);
  };

  const openFile = async (storagePath: string) => {
    const url = await openTaskFile(storagePath);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const archive = async () => {
    if (!task || busy || isMutating) return;
    setBusy(true);
    const archived = await archiveTask(task.id);
    setBusy(false);
    if (archived) onSaved?.(archived);
  };

  const remove = async () => {
    if (!task || busy || isMutating || cannotDelete) return;
    setBusy(true);
    const deleted = await removeTask(task.id);
    setBusy(false);
    if (deleted) onDeleted?.();
  };

  const requestTaskAssistance = async (objective: TaskAssistObjective) => {
    if (!task || !organization || aiBusy) return;
    setLocalError(null);
    setAiBusy(objective);
    try {
      const response = await authenticatedFetch("/api/openclaw/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organization.id,
          entity_type: "task",
          entity_id: task.id,
          objective,
          instructions:
            "Use only confirmed CRM facts. Do not modify records or perform external actions.",
        }),
      });
      const payload = (await response.json()) as { content?: string; detail?: string };
      if (!response.ok || !payload.content) {
        throw new Error(payload.detail || "OpenClaw не вернул результат.");
      }
      setAiResult({ objective, content: payload.content });
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Не удалось получить рекомендацию OpenClaw.",
      );
    } finally {
      setAiBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {isCreating ? "Новая задача" : "Карточка задачи"}
          </p>
          <input
            value={draft.title}
            onChange={(event) => setField("title", event.target.value)}
            placeholder="Название задачи"
            className="mt-1 w-full bg-transparent font-display text-xl font-semibold outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          {task && (
            <Link
              to="/tasks/$taskId"
              params={{ taskId: task.id }}
              title="Открыть карточку задачи на отдельной странице"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Страница</span>
            </Link>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          )}
        </div>
      </div>

      {localError && (
        <div className="rounded-xl border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {localError}
        </div>
      )}

      <textarea
        value={draft.description}
        onChange={(event) => setField("description", event.target.value)}
        rows={4}
        placeholder="Описание, контекст, ссылки"
        className="w-full resize-none rounded-xl border border-border bg-surface-2/60 p-3 text-sm outline-none transition focus:border-primary/60"
      />

      {task && (
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-primary" />
            OpenClaw для задачи
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Только рекомендации: данные CRM и внешние сервисы не изменяются автоматически.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["plan_task", "План выполнения"],
                ["summarize_history", "Резюме"],
                ["qa_review", "QA-проверка"],
              ] as const
            ).map(([objective, label]) => (
              <button
                key={objective}
                type="button"
                disabled={Boolean(aiBusy)}
                onClick={() => requestTaskAssistance(objective)}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/30 px-3 py-1.5 text-xs text-primary transition hover:bg-primary/10 disabled:opacity-50"
              >
                {aiBusy === objective && <Loader2 className="size-3.5 animate-spin" />}
                {label}
              </button>
            ))}
          </div>
          {aiResult && (
            <div className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-background/70 p-3 text-sm">
              {aiResult.content}
              <p className="mt-3 text-xs text-muted-foreground">
                Рекомендация сохранена в audit log (журнале аудита); изменения не применены.
              </p>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Статус">
          <select
            value={draft.status}
            disabled={busy || isMutating}
            onChange={(event) => setField("status", event.target.value as TaskStatus)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Приоритет">
          <select
            value={draft.priority}
            disabled={busy || isMutating}
            onChange={(event) => setField("priority", event.target.value as Priority)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Проект">
          <select
            value={draft.projectId}
            disabled={busy || isMutating}
            onChange={(event) => setField("projectId", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          >
            <option value="">Без проекта</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Родительская">
          <select
            value={draft.parentTaskId}
            disabled={busy || isMutating}
            onChange={(event) => setField("parentTaskId", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          >
            <option value="">Нет</option>
            {parentOptions.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Дата начала">
          <input
            type="date"
            value={draft.startDate}
            disabled={busy || isMutating}
            onChange={(event) => setField("startDate", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          />
        </Field>
        <Field label="Дедлайн">
          <input
            type="date"
            value={draft.dueDate}
            disabled={busy || isMutating}
            onChange={(event) => setField("dueDate", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          />
        </Field>
        <Field label="Оценка, мин">
          <input
            type="number"
            min="0"
            step="1"
            value={draft.estimatedMinutes}
            disabled={busy || isMutating}
            onChange={(event) => setField("estimatedMinutes", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          />
        </Field>
        <Field label="Факт, мин">
          <input
            type="number"
            min="0"
            step="1"
            value={draft.actualMinutes}
            disabled={busy || isMutating}
            onChange={(event) => setField("actualMinutes", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Исполнитель">
          <select
            value={draft.assigneeId}
            disabled={busy || isMutating || !members.length}
            onChange={(event) => setField("assigneeId", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          >
            <option value="">Не назначен</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {memberLabel(member)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ожидаемый доход">
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.expectedRevenue}
            disabled={busy || isMutating}
            onChange={(event) => setField("expectedRevenue", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          />
        </Field>
        <Field label="Внутренняя стоимость">
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.internalCost}
            disabled={busy || isMutating}
            onChange={(event) => setField("internalCost", event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none"
          />
        </Field>
        <Field label="Валюта">
          <div className="flex items-center gap-2">
            <input
              value={draft.currency}
              maxLength={3}
              disabled={busy || isMutating}
              onChange={(event) => setField("currency", event.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm uppercase outline-none"
            />
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2/60 px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <span>{CURRENCY_FLAGS[draft.currency.trim().toUpperCase()] ?? "¤"}</span>
              <span className="hidden sm:inline">{draft.currency.trim().toUpperCase() || "EUR"}</span>
            </span>
          </div>
        </Field>
      </div>

      <div className="rounded-xl border border-border bg-surface-2/35 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Прогресс</span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              {draft.progress}%
            </span>
          </div>
          {task?.estimatedTimeRemaining !== null && task?.estimatedTimeRemaining !== undefined && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              Осталось ~{task.estimatedTimeRemaining} мин
            </div>
          )}
        </div>
        <Progress value={draft.progress} className="h-2.5" />
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.progress}
            disabled={busy || isMutating}
            onChange={(event) => setField("progress", Number(event.target.value))}
            className="flex-1 accent-primary"
          />
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={draft.progress}
            disabled={busy || isMutating}
            onChange={(event) => {
              const val = Math.min(100, Math.max(0, Number(event.target.value) || 0));
              setField("progress", val);
            }}
            className="w-16 rounded-lg border border-border bg-surface-2 px-2 py-1 text-center text-sm outline-none"
          />
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Метки</span>
            <span className="text-xs text-muted-foreground">{draft.labelIds.length} выбрано</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {taskLabels.map((label) => (
              <button
                key={label.id}
                type="button"
                onClick={() => toggleId("labelIds", label.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition",
                  draft.labelIds.includes(label.id)
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="size-2 rounded-full" style={{ background: label.color }} />
                {label.name}
              </button>
            ))}
            {!taskLabels.length && (
              <span className="text-sm text-muted-foreground">Метки пока не созданы.</span>
            )}
          </div>
          <input
            value={draft.newLabels}
            disabled={busy || isMutating}
            onChange={(event) => setField("newLabels", event.target.value)}
            placeholder="Новые метки через запятую"
            className="mt-3 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Наблюдатели
            </span>
            <span className="text-xs text-muted-foreground">{draft.watcherIds.length} выбрано</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((member) => (
              <label
                key={member.userId}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={draft.watcherIds.includes(member.userId)}
                  disabled={busy || isMutating}
                  onChange={() => toggleId("watcherIds", member.userId)}
                  className="size-4 accent-primary"
                />
                <span className="truncate">{memberLabel(member)}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-2/35 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Чек-лист</h3>
            {task && (
              <span className="text-xs text-muted-foreground">
                {task.checklistItems.filter((item) => item.completedAt).length}/
                {task.checklistItems.length}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {task?.checklistItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg bg-surface px-2 py-2"
              >
                <button
                  type="button"
                  onClick={() =>
                    void updateChecklistItem(task.id, item.id, {
                      completed: !item.completedAt,
                    })
                  }
                  className={cn(
                    "grid size-5 place-items-center rounded border",
                    item.completedAt
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border",
                  )}
                >
                  {item.completedAt && <Check className="size-3.5" />}
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    item.completedAt && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
                <button
                  type="button"
                  onClick={() => void deleteChecklistItem(task.id, item.id)}
                  className="text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {pendingChecklist.map((title, index) => (
              <div
                key={`${title}-${index}`}
                className="flex items-center gap-2 rounded-lg bg-surface px-2 py-2 text-sm"
              >
                <span className="flex-1 truncate">{title}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingChecklist((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {!task?.checklistItems.length && !pendingChecklist.length && (
              <p className="text-sm text-muted-foreground">Пока пусто.</p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={checklistTitle}
              disabled={busy || isMutating}
              onChange={(event) => setChecklistTitle(event.target.value)}
              placeholder="Новый пункт"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void addChecklist()}
              disabled={busy || isMutating || !checklistTitle.trim()}
              className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-2/35 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Подзадачи</h3>
            <span className="text-xs text-muted-foreground">
              {task ? childTasks.length : pendingSubtasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {childTasks.map((child) => (
              <div key={child.id} className="rounded-lg bg-surface px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {STATUS_LABEL[child.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {projectLabel(projects, child.projectId)}
                </p>
              </div>
            ))}
            {pendingSubtasks.map((title, index) => (
              <div
                key={`${title}-${index}`}
                className="flex items-center gap-2 rounded-lg bg-surface px-2 py-2 text-sm"
              >
                <span className="flex-1 truncate">{title}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingSubtasks((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {!childTasks.length && !pendingSubtasks.length && (
              <p className="text-sm text-muted-foreground">Пока пусто.</p>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={subtaskTitle}
              disabled={busy || isMutating}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              placeholder="Новая подзадача"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void addSubtask()}
              disabled={busy || isMutating || !subtaskTitle.trim()}
              className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-2/35 p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Комментарии</h3>
          </div>
          <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
            {task?.comments.map((comment) => (
              <div key={comment.id} className="rounded-lg bg-surface px-3 py-2">
                <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString("ru-RU")}
                </p>
              </div>
            ))}
            {!task?.comments.length && !isCreating && (
              <p className="text-sm text-muted-foreground">Комментариев пока нет.</p>
            )}
          </div>
          <textarea
            value={commentBody}
            disabled={busy || isMutating}
            onChange={(event) => setCommentBody(event.target.value)}
            rows={3}
            placeholder={isCreating ? "Первый комментарий после создания" : "Новый комментарий"}
            className="mt-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none"
          />
          {!isCreating && (
            <button
              type="button"
              onClick={() => void addComment()}
              disabled={busy || isMutating || !commentBody.trim()}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              <Plus className="size-4" />
              Добавить
            </button>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface-2/35 p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileUp className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Вложения</h3>
          </div>
          <div className="space-y-2">
            {task?.files.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => void openFile(file.storagePath)}
                className="flex w-full items-center gap-3 rounded-lg bg-surface px-3 py-2 text-left text-sm transition hover:text-primary"
              >
                <Download className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {(file.sizeBytes / 1024).toFixed(0)} КБ
                </span>
              </button>
            ))}
            {pendingFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-sm"
              >
                <FileUp className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setPendingFiles((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {!task?.files.length && !pendingFiles.length && (
              <p className="text-sm text-muted-foreground">Файлы ещё не прикреплены.</p>
            )}
          </div>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground">
            <FileUp className="size-4" />
            Загрузить файл
            <input
              type="file"
              multiple
              className="hidden"
              disabled={busy || isMutating}
              onChange={(event) => void uploadFiles(event.target.files)}
            />
          </label>
        </div>
      </section>

      {task?.completedAt && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">
          Завершено {new Date(task.completedAt).toLocaleString("ru-RU")}
        </div>
      )}

      {cannotDelete && (
        <div className="rounded-xl border border-acc-3/30 bg-acc-3/5 px-3 py-2 text-sm text-acc-3">
          У задачи есть дочерние задачи или финансовые операции, поэтому физическое удаление
          недоступно. Используйте архивирование.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {task && (
            <button
              type="button"
              onClick={() => void archive()}
              disabled={busy || isMutating || Boolean(task.archivedAt)}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
            >
              <Archive className="size-4" />
              {task.archivedAt ? "В архиве" : "Архивировать"}
            </button>
          )}
          {task && !cannotDelete && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy || isMutating}
              className="inline-flex items-center gap-2 rounded-xl border border-destructive/35 px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
            >
              <Trash2 className="size-4" />
              Удалить
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy || isMutating}
              className="rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-2 disabled:opacity-60"
            >
              Отмена
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || isMutating || !draft.title.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {(busy || isMutating) && <Loader2 className="size-4 animate-spin" />}
            {isCreating ? "Создать" : "Сохранить"}
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
