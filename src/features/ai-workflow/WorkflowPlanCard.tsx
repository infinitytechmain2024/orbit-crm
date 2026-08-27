import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { TaskDependency, WorkflowAgent, WorkflowRun, WorkflowTask } from "./types";

const statusLabel: Record<WorkflowTask["status"], string> = {
  planning: "Планируется",
  queued: "В очереди",
  in_progress: "В работе",
  paused: "Приостановлено",
  review: "На проверке",
  approval_required: "Ожидает решения",
  done: "Готово",
  blocked: "Заблокировано",
  revisions_requested: "На доработке",
  cancelled: "Отменено",
};

function StepIcon({ status }: { status: WorkflowTask["status"] }) {
  if (status === "done") return <CheckCircle2 className="size-4 text-badge-green" />;
  if (status === "review") return <ShieldCheck className="size-4 text-badge-purple" />;
  if (status === "in_progress")
    return <CircleDashed className="size-4 animate-spin text-badge-blue" />;
  if (status === "blocked" || status === "revisions_requested")
    return <Ban className="size-4 text-badge-red" />;
  return <Clock3 className="size-4 text-muted-foreground" />;
}

export function WorkflowPlanCard({
  tasks,
  agents,
  runs,
  dependencies,
  onOpen,
  onControl,
  isMutating,
  setIsMutating,
}: {
  tasks: WorkflowTask[];
  agents: WorkflowAgent[];
  runs: WorkflowRun[];
  dependencies: TaskDependency[];
  onOpen: (task: WorkflowTask) => void;
  onControl: (task: WorkflowTask, action: "pause" | "resume" | "retry" | "cancel") => void;
  isMutating: boolean;
  setIsMutating: (mutating: boolean) => void;
}) {
  const roots = tasks.filter((task) => !task.parent_task_id);
  const root =
    roots.find((task) =>
      [
        "planning",
        "queued",
        "in_progress",
        "paused",
        "review",
        "approval_required",
        "blocked",
      ].includes(task.status),
    ) ?? roots[0];
  if (!root) return null;
  const run = runs.find((item) => item.root_task_id === root.id);
  const steps = tasks
    .filter((task) => task.parent_task_id === root.id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const done = steps.filter((task) => task.status === "done").length;
  const progress = run?.progress ?? (steps.length ? Math.round((done / steps.length) * 100) : 5);
  const plan = root.execution_plan as { summary?: unknown } | undefined;

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-surface/95 to-surface-2/95 p-4 shadow-[0_18px_60px_-42px_rgba(35,211,202,.9)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            <Sparkles className="size-3.5" /> План Orbit Commander
          </p>
          <button
            type="button"
            onClick={() => onOpen(root)}
            className="mt-1 max-w-3xl text-left text-base font-semibold hover:text-primary"
          >
            {root.title}
          </button>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">
            {typeof plan?.summary === "string"
              ? plan.summary
              : root.status === "planning"
                ? "Анализирую цель, контекст проекта и зависимости…"
                : root.goal || "AI-команда выполняет согласованный план."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px]",
              root.status === "approval_required"
                ? "border-badge-yellow/30 text-badge-yellow"
                : root.status === "blocked"
                  ? "border-badge-red/30 text-badge-red"
                  : "border-primary/25 text-primary",
            )}
          >
            {statusLabel[root.status]}
          </span>
          {root.status === "paused" ? (
            <ControlButton
              label="Resume"
              icon={Play}
              onClick={() => onControl(root, "resume")}
              disabled={isMutating}
            />
          ) : !["done", "cancelled", "approval_required"].includes(root.status) ? (
            <ControlButton
              label="Pause"
              icon={Pause}
              onClick={() => onControl(root, "pause")}
              disabled={isMutating}
            />
          ) : null}
          {["blocked", "revisions_requested"].includes(root.status) && (
            <ControlButton
              label="Retry"
              icon={RotateCcw}
              onClick={() => onControl(root, "retry")}
              disabled={isMutating}
            />
          )}
          {!["done", "cancelled"].includes(root.status) && (
            <ControlButton
              label="Cancel"
              icon={Ban}
              onClick={() => onControl(root, "cancel")}
              disabled={isMutating}
              danger
            />
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{run?.current_phase ? `Этап: ${run.current_phase}` : "Подготовка workflow"}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary transition-all"
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {steps.length ? (
          steps.map((step, index) => {
            const waitingFor = dependencies.filter((item) => item.task_id === step.id).length;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onOpen(step)}
                className="flex min-w-0 items-start gap-3 rounded-xl border border-border/80 bg-surface-2/50 p-3 text-left transition hover:border-primary/35 hover:bg-surface-2/70"
              >
                <StepIcon status={step.status} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                    {index + 1}. {agentById.get(step.agent_id ?? "")?.role ?? "Назначается"}
                  </span>
                  <span className="mt-1 block truncate text-[11px] font-medium">{step.title}</span>
                  <span className="mt-1 block text-[9px] text-muted-foreground">
                    {statusLabel[step.status]}
                    {waitingFor > 0 && step.status === "queued"
                      ? ` · зависит от ${waitingFor}`
                      : ""}
                    {step.qa_status === "passed" ? " · QA пройден" : ""}
                  </span>
                </span>
              </button>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-border p-4 text-[11px] text-muted-foreground md:col-span-2 xl:col-span-3">
            Orbit Commander формирует подзадачи, исполнителей и зависимости. Карточки появятся
            автоматически.
          </div>
        )}
      </div>
    </section>
  );
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] transition",
        danger
          ? "border-badge-red/25 text-badge-red hover:bg-badge-red-bg"
          : "border-border text-muted-foreground hover:border-primary/35 hover:text-primary",
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}
