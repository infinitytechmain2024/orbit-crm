import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  File,
  Layers3,
  Loader2,
  Play,
  Send,
  Sparkles,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  WorkflowAgent,
  WorkflowArtifact,
  WorkflowEvent,
  WorkflowProject,
  WorkflowTask,
} from "./types";

const controlClass =
  "h-10 w-full rounded-xl border border-border bg-[#0a1722] px-3 text-xs outline-none focus:border-primary/60";

export function AgentProfileDialog({
  agent,
  tasks,
  events,
  artifacts,
  projects,
  onClose,
  onAssign,
}: {
  agent: WorkflowAgent | null;
  tasks: WorkflowTask[];
  events: WorkflowEvent[];
  artifacts: WorkflowArtifact[];
  projects: WorkflowProject[];
  onClose: () => void;
  onAssign: (task: WorkflowTask, agent: WorkflowAgent) => Promise<void>;
}) {
  const [taskId, setTaskId] = useState("");
  const [isAssigning, setAssigning] = useState(false);
  const agentTasks = useMemo(
    () => (agent ? tasks.filter((task) => task.agent_id === agent.id) : []),
    [agent, tasks],
  );
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const assignable = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const agentEvents = agent ? events.filter((event) => event.agent_id === agent.id) : [];
  const agentArtifacts = agent
    ? artifacts.filter((artifact) => artifact.agent_id === agent.id)
    : [];

  return (
    <Dialog
      open={Boolean(agent)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-[#0b1823]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Bot className="size-5" />
            </span>
            <span>
              {agent?.role}
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {agent?.description}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Профиль AI-агента и его рабочая статистика
          </DialogDescription>
        </DialogHeader>
        {agent && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="В очереди"
                value={agentTasks.filter((task) => task.status === "queued").length}
              />
              <Stat
                label="В работе"
                value={agentTasks.filter((task) => task.status === "in_progress").length}
              />
              <Stat
                label="Готово"
                value={agentTasks.filter((task) => task.status === "done").length}
              />
            </div>
            <div className="rounded-xl border border-border bg-white/[0.02] p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Текущая модель
              </p>
              <p className="mt-1 break-all text-xs font-medium text-primary">
                {agent.default_model ||
                  agentTasks.find((task) => task.current_model)?.current_model ||
                  "Выбирается AI Router по capability tags"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <span
                    key={capability}
                    className="rounded-md border border-border px-1.5 py-1 text-[9px] text-muted-foreground"
                  >
                    {capability}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-xl border border-border p-3">
                <h3 className="text-xs font-semibold">История действий</h3>
                <div className="aiwf-plain-list mt-2 space-y-2">
                  {agentEvents.slice(0, 6).map((event) => (
                    <div key={event.id} className="border-l border-primary/30 pl-2">
                      <p className="text-[10px] leading-4">{event.message}</p>
                      <time className="text-[9px] text-muted-foreground">
                        {new Date(event.created_at).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                  ))}
                  {!agentEvents.length && (
                    <p className="text-[10px] text-muted-foreground">История пока пустая</p>
                  )}
                </div>
              </section>
              <section className="rounded-xl border border-border p-3">
                <h3 className="text-xs font-semibold">Последние артефакты</h3>
                <div className="aiwf-plain-list mt-2 space-y-2">
                  {agentArtifacts.slice(0, 6).map((artifact) => (
                    <a
                      key={artifact.id}
                      href={artifact.url}
                      className="flex items-center gap-2 rounded-lg bg-white/[0.025] p-2 text-[10px] hover:text-primary"
                    >
                      <File className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
                      <ExternalLink className="size-3" />
                    </a>
                  ))}
                  {!agentArtifacts.length && (
                    <p className="text-[10px] text-muted-foreground">Артефакты ещё не созданы</p>
                  )}
                </div>
              </section>
            </div>
            <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
              <h3 className="text-xs font-semibold">Назначить задачу агенту</h3>
              <div className="mt-2 flex gap-2">
                <select
                  value={taskId}
                  onChange={(event) => setTaskId(event.target.value)}
                  className={controlClass}
                >
                  <option value="">Выберите задачу</option>
                  {assignable.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title} ·{" "}
                      {task.project_id ? projectById.get(task.project_id)?.name : "Без проекта"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!taskId || isAssigning}
                  onClick={() => {
                    const task = tasks.find((item) => item.id === taskId);
                    if (!task) return;
                    setAssigning(true);
                    void onAssign(task, agent).finally(() => {
                      setAssigning(false);
                      setTaskId("");
                    });
                  }}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {isAssigning && <Loader2 className="size-4 animate-spin" />}Назначить
                </button>
              </div>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-3 text-center">
      <strong className="block text-lg">{value}</strong>
      <span className="text-[9px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function TaskDetailDialog({
  task,
  project,
  agent,
  departmentName,
  artifacts,
  onClose,
  onRun,
  onApproval,
}: {
  task: WorkflowTask | null;
  project?: WorkflowProject | undefined;
  agent?: WorkflowAgent | undefined;
  departmentName?: string | undefined;
  artifacts: WorkflowArtifact[];
  onClose: () => void;
  onRun: (task: WorkflowTask) => void;
  onApproval: (task: WorkflowTask) => void;
}) {
  const resultSummary = task?.result?.["summary"];
  const resultContent = task?.result?.["content"];
  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-[#0b1823]">
        <DialogHeader>
          <DialogTitle className="pr-8 text-lg">{task?.title}</DialogTitle>
          <DialogDescription>
            {project?.name ?? "Без проекта"} · {departmentName ?? "Отдел не выбран"} ·{" "}
            {agent?.role ?? "Агент не назначен"}
          </DialogDescription>
        </DialogHeader>
        {task && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-lg border border-border px-2 py-1">
                Статус: {task.status}
              </span>
              <span className="rounded-lg border border-border px-2 py-1">
                Приоритет: {task.priority}
              </span>
              <span className="rounded-lg border border-border px-2 py-1">
                Модель: {task.current_model ?? "выбирается"}
              </span>
              {task.openclaw_execution && (
                <span className="rounded-lg border border-border px-2 py-1">
                  Runtime: {task.openclaw_execution.runtime}
                </span>
              )}
              {task.openclaw_execution && task.openclaw_execution.provider && (
                <span className="rounded-lg border border-border px-2 py-1">
                  Provider: {task.openclaw_execution.provider}
                </span>
              )}
              {task.openclaw_execution && task.openclaw_execution.requested_pool && (
                <span className="rounded-lg border border-border px-2 py-1">
                  Pool: {task.openclaw_execution.requested_pool}
                </span>
              )}
              {task.openclaw_execution && task.openclaw_execution.actual_model_used && (
                <span className="rounded-lg border border-border px-2 py-1">
                  Model: {task.openclaw_execution.actual_model_used}
                </span>
              )}
              {task.openclaw_execution && task.openclaw_execution.fallback_attempts && task.openclaw_execution.fallback_attempts.length > 0 && (
                <span className="rounded-lg border border-border px-2 py-1 text-[9px] text-muted-foreground">
                  Fallback: {task.openclaw_execution.fallback_attempts.length} attempt{task.openclaw_execution.fallback_attempts.length > 1 && 's'}
                </span>
              )}
              <span className="rounded-lg border border-border px-2 py-1">
                QA: {task.qa_status ?? "pending"}
              </span>
              {task.risk_level && (
                <span className="rounded-lg border border-border px-2 py-1">
                  Риск: {task.risk_level}
                </span>
              )}
            </div>
            <section className="rounded-xl border border-border bg-white/[0.02] p-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold">
                <Layers3 className="size-4 text-primary" /> Описание
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {task.description || "Описание не добавлено"}
              </p>
            </section>
            {Boolean(task.execution_plan && Object.keys(task.execution_plan).length) && (
              <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.025] p-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <Sparkles className="size-4 text-cyan-300" /> Что будет сделано
                </h3>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-muted-foreground">
                  {JSON.stringify(task.execution_plan, null, 2)}
                </pre>
              </section>
            )}
            {task.blocker_reason && (
              <section className="rounded-xl border border-red-400/25 bg-red-400/[0.04] p-3 text-xs text-red-200">
                <strong className="block">Причина блокировки</strong>
                <p className="mt-1 leading-5">{task.blocker_reason}</p>
              </section>
            )}
            {task.qa_report && (
              <section className="rounded-xl border border-violet-400/20 bg-violet-400/[0.03] p-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <CheckCircle2 className="size-4 text-violet-300" /> QA-отчёт
                </h3>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[10px] leading-5 text-muted-foreground">
                  {JSON.stringify(task.qa_report, null, 2)}
                </pre>
              </section>
            )}
            {task.result && (
              <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3">
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  <Sparkles className="size-4 text-primary" /> Результат
                </h3>
                {typeof resultSummary === "string" && (
                  <p className="mt-2 text-xs font-medium">{resultSummary}</p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {typeof resultContent === "string"
                    ? resultContent
                    : JSON.stringify(task.result, null, 2)}
                </p>
              </section>
            )}
            <section className="rounded-xl border border-border p-3">
              <h3 className="text-xs font-semibold">Артефакты задачи</h3>
              <div className="aiwf-plain-list mt-2 space-y-1">
                {artifacts
                  .filter((artifact) => artifact.task_id === task.id)
                  .map((artifact) => (
                    <a
                      key={artifact.id}
                      href={artifact.url}
                      className="flex items-center gap-2 rounded-lg bg-white/[0.025] p-2 text-[10px] hover:text-primary"
                    >
                      <File className="size-3.5" />
                      <span className="flex-1">{artifact.name}</span>
                      <ExternalLink className="size-3" />
                    </a>
                  ))}
                {!artifacts.some((artifact) => artifact.task_id === task.id) && (
                  <p className="text-[10px] text-muted-foreground">
                    Артефакты появятся после выполнения.
                  </p>
                )}
              </div>
            </section>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Clock3 className="size-3.5" /> Обновлено{" "}
              {new Date(task.updated_at).toLocaleString("ru-RU")}
              {task.status === "done" && (
                <CheckCircle2 className="ml-auto size-4 text-emerald-300" />
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-border px-4 text-xs"
          >
            Закрыть
          </button>
          {task && task.status !== "done" && (
            <>
              <button
                type="button"
                onClick={() => onApproval(task)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-400/30 px-4 text-xs text-amber-200"
              >
                <Send className="size-4" /> На утверждение
              </button>
              <button
                type="button"
                onClick={() => onRun(task)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
              >
                <Play className="size-4" /> Запустить
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
