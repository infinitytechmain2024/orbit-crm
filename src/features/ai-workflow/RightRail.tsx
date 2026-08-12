import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Code2,
  ExternalLink,
  File,
  FileSpreadsheet,
  Link2,
  Radio,
  Sparkles,
} from "lucide-react";

import type {
  ApprovalRequest,
  WorkflowAgent,
  WorkflowArtifact,
  WorkflowEvent,
  WorkflowProject,
  WorkflowTask,
} from "./types";

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function eventColor(type: string) {
  if (["completed", "approved"].includes(type)) return "bg-emerald-400";
  if (["blocked", "rejected", "model_failure"].includes(type)) return "bg-red-400";
  if (["approval_requested", "subtasks_created"].includes(type)) return "bg-amber-400";
  if (["assigned", "model_fallback"].includes(type)) return "bg-violet-400";
  return "bg-cyan-400";
}

function ArtifactIcon({ type }: { type: string }) {
  if (/sheet|table|xlsx|csv/i.test(type)) return <FileSpreadsheet className="size-4" />;
  if (/code/i.test(type)) return <Code2 className="size-4" />;
  if (/link/i.test(type)) return <Link2 className="size-4" />;
  return <File className="size-4" />;
}

export function RightRail({
  events,
  artifacts,
  tasks,
  agents,
  projects,
  approvals,
  selectedProjectId,
  realtimeConnected,
  onTaskOpen,
}: {
  events: WorkflowEvent[];
  artifacts: WorkflowArtifact[];
  tasks: WorkflowTask[];
  agents: WorkflowAgent[];
  projects: WorkflowProject[];
  approvals: ApprovalRequest[];
  selectedProjectId: string;
  realtimeConnected: boolean;
  onTaskOpen: (task: WorkflowTask) => void;
}) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const completedToday = tasks.filter(
    (task) =>
      task.status === "done" &&
      new Date(task.updated_at).toDateString() === new Date().toDateString(),
  ).length;
  const selectedTasks =
    selectedProjectId === "all"
      ? tasks
      : tasks.filter((task) => task.project_id === selectedProjectId);
  const progress = selectedTasks.length
    ? Math.round(
        (selectedTasks.filter((task) => task.status === "done").length / selectedTasks.length) *
          100,
      )
    : 0;
  const risks = tasks.filter(
    (task) => task.status === "blocked" || task.status === "revisions_requested",
  );

  return (
    <aside className="space-y-3 xl:sticky xl:top-28">
      <section className="rounded-2xl border border-[#254252]/75 bg-[#0b1925]/90 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Лента выполнения</h2>
          <span
            className={`inline-flex items-center gap-1.5 text-[9px] ${realtimeConnected ? "text-emerald-300" : "text-muted-foreground"}`}
          >
            <Radio className="size-3" />
            {realtimeConnected ? "Realtime" : "Подключение"}
          </span>
        </div>
        {events.length ? (
          <div className="aiwf-plain-list mt-3 max-h-[26rem] overflow-y-auto pr-1">
            {events.slice(0, 12).map((event, index) => {
              const task = taskById.get(event.task_id);
              const agent = event.agent_id ? agentById.get(event.agent_id) : undefined;
              const project = event.project_id ? projectById.get(event.project_id) : undefined;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => task && onTaskOpen(task)}
                  className="relative block w-full border-b border-border/55 py-3 pl-7 text-left last:border-0"
                >
                  <span
                    className={`absolute left-1 top-4 size-2 rounded-full ${eventColor(event.event_type)} shadow-[0_0_9px_currentColor]`}
                  />
                  {index < events.length - 1 && (
                    <span className="absolute bottom-0 left-[7px] top-6 w-px bg-border" />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] font-medium">
                      {agent?.role ?? "AI Router"}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {project?.name ?? "Orbit CRM"}
                      </span>
                    </p>
                    <time className="shrink-0 text-[9px] text-muted-foreground">
                      {relativeTime(event.created_at)}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                    {event.message}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Sparkles className="mx-auto size-7 text-primary/40" />
            <p className="mt-2 text-xs text-muted-foreground">
              События появятся после создания задачи
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#254252]/75 bg-[#0b1925]/90 p-4 backdrop-blur-xl">
        <h2 className="text-sm font-semibold">Последние артефакты</h2>
        {artifacts.length ? (
          <div className="aiwf-plain-list mt-3 space-y-1">
            {artifacts.slice(0, 6).map((artifact) => {
              const agent = artifact.agent_id ? agentById.get(artifact.agent_id) : undefined;
              const project = artifact.project_id
                ? projectById.get(artifact.project_id)
                : undefined;
              return (
                <a
                  key={artifact.id}
                  href={artifact.url}
                  className="group flex items-center gap-2.5 rounded-xl p-2 transition hover:bg-white/[0.035]"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-[#0a1722] text-primary">
                    <ArtifactIcon type={artifact.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-medium">{artifact.name}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                      {artifact.type} · {project?.name ?? "Проект"} · {agent?.role ?? "AI"}
                    </span>
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {relativeTime(artifact.created_at)}
                  </span>
                  <ExternalLink className="size-3 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </a>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Пока нет созданных результатов
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-[#254252]/75 bg-[#0b1925]/90 p-4 backdrop-blur-xl">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-primary" /> AI-сводка
        </h2>
        <div className="aiwf-plain-list mt-3 space-y-2 text-[10px]">
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Всего задач в работе</span>
            <strong>{inProgress}</strong>
          </p>
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Завершено сегодня</span>
            <strong className="text-emerald-300">{completedToday}</strong>
          </p>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Прогресс проекта</span>
              <strong>{progress}%</strong>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <p className="flex items-center justify-between">
            <span className="text-muted-foreground">Ожидают решения CEO</span>
            <strong className="text-amber-300">{approvals.length}</strong>
          </p>
        </div>
        <div
          className={`mt-3 rounded-xl border px-3 py-2 ${risks.length ? "border-amber-400/25 bg-amber-400/8" : "border-emerald-400/20 bg-emerald-400/8"}`}
        >
          <p
            className={`flex items-start gap-2 text-[10px] ${risks.length ? "text-amber-200" : "text-emerald-300"}`}
          >
            {risks.length ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>
              {risks.length
                ? `Риски: ${risks
                    .slice(0, 2)
                    .map((task) => task.title)
                    .join("; ")}`
                : "Активных блокеров не обнаружено"}
            </span>
          </p>
        </div>
      </section>
    </aside>
  );
}
