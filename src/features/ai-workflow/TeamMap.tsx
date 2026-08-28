import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Bug,
  Code2,
  Database,
  Mail,
  Megaphone,
  Network,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import type {
  ApprovalRequest,
  WorkflowAgent,
  WorkflowDepartment,
  WorkflowProject,
  WorkflowTask,
} from "./types";

const ROLE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "Orbit Commander": Sparkles,
  "Backend Engineer": Database,
  "Frontend Engineer": Code2,
  "AI Engineer": Bot,
  "DevOps / Ops Agent": Network,
  "QA Agent": ShieldCheck,
  "Research Agent": Search,
  "Content Agent": Mail,
  "Design Agent": Sparkles,
  "Business Analyst": BriefcaseBusiness,
  CEO: BriefcaseBusiness,
  Frontend: Code2,
  Backend: Database,
  "QA / DevOps": ShieldCheck,
  "AI Integrations": Bot,
  CMO: Megaphone,
  "Sales Rep": BriefcaseBusiness,
  SEO: Search,
  SMM: Send,
  Рассылка: Mail,
  Парсинг: Network,
  "Data Analyst": BarChart3,
  Рекрутинг: UserRoundPlus,
  Онбординг: UserRound,
  "People Ops": UsersRound,
  COO: Bug,
};

const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function counts(tasks: WorkflowTask[]) {
  return {
    queued: tasks.filter((task) => task.status === "queued").length,
    active: tasks.filter(
      (task) =>
        task.status === "planning" ||
        task.status === "in_progress" ||
        task.status === "review" ||
        task.status === "revisions_requested",
    ).length,
    done: tasks.filter((task) => task.status === "done").length,
  };
}

function currentTask(tasks: WorkflowTask[]) {
  return (
    tasks.find((task) => task.status === "in_progress") ??
    tasks.find((task) => task.status === "review") ??
    tasks.find((task) => task.status === "planning") ??
    tasks.find((task) => task.status === "queued")
  );
}

export function TeamMap({
  departments,
  agents,
  tasks,
  projects,
  approvals,
  selectedDepartmentId,
  selectedProjectId,
  lastRealtimeAt,
  onDepartmentClick,
  onAgentClick,
  onApprove,
  onReject,
}: {
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tasks: WorkflowTask[];
  projects: WorkflowProject[];
  approvals: ApprovalRequest[];
  selectedDepartmentId: string;
  selectedProjectId?: string;
  lastRealtimeAt: number;
  onDepartmentClick: (department: WorkflowDepartment) => void;
  onAgentClick: (agent: WorkflowAgent) => void;
  onApprove: (task: WorkflowTask) => void;
  onReject: (task: WorkflowTask) => void;
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const nextApproval = approvals[0];
  const initiator = nextApproval?.requested_by_agent_id
    ? agentById.get(nextApproval.requested_by_agent_id)
    : undefined;
  const activeTransfer = Date.now() - lastRealtimeAt < 6000;

  const ceoDepartment =
    departments.find((department) => department.name === "CEO") ?? departments[0];
  const childDepartments = departments.filter((department) => department !== ceoDepartment);

  const n = childDepartments.length;
  const firstRowCount = n > 4 ? 4 : n;
  const childX = Array.from({ length: Math.max(firstRowCount, 1) }, (_, index) =>
    Math.round(((index + 0.5) / firstRowCount) * 1000),
  );

  const systemStats = counts(tasks);

  const globalProject =
    selectedProjectId && selectedProjectId !== "all"
      ? projectById.get(selectedProjectId)
      : (() => {
          const ranked = projects
            .map((project) => ({
              project,
              weight:
                tasks.filter((task) => task.project_id === project.id).length +
                (project.status === "active" ? 100 : 0),
            }))
            .sort((a, b) => b.weight - a.weight);
          return ranked[0]?.project;
        })();

  const globalTasks = globalProject
    ? tasks.filter((task) => task.project_id === globalProject.id)
    : tasks;
  const strategicGoalTask = globalTasks
    .filter((task) => !task.parent_task_id && task.status !== "done")
    .sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))[0];
  const strategicGoal =
    strategicGoalTask?.title ?? "Координация стратегии и распределение работ по отделам";

  const initiatorDepartmentIndex = childDepartments.findIndex(
    (department) => department.id === initiator?.department_id,
  );

  const ceoY = 6;
  const busY = 38;
  const childY = 96;
  const branchPath = (x: number) => `M500 ${ceoY} V${busY} H${x} V${childY}`;

  return (
    <section aria-label="Карта AI-команды" className="relative">
      <div className="mx-auto max-w-5xl">
        <article
          className={cn(
            "relative mx-auto w-full max-w-3xl rounded-2xl border bg-gradient-to-b from-amber-500/10 to-surface/88 p-4 backdrop-blur-xl transition",
            selectedDepartmentId === ceoDepartment?.id
              ? "border-badge-yellow/60 shadow-[0_0_45px_-18px_rgba(245,158,11,.85)]"
              : "border-badge-yellow/30 hover:border-badge-yellow/45 shadow-[0_0_40px_-22px_rgba(245,158,11,.7)]",
          )}
        >
          <button
            type="button"
            onClick={() => ceoDepartment && onDepartmentClick(ceoDepartment)}
            className="flex w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full border border-badge-yellow/35 bg-badge-yellow-bg text-badge-yellow">
              <BriefcaseBusiness className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">CEO</h2>
                <span className="rounded-full border border-badge-yellow/25 bg-badge-yellow-bg px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-badge-yellow">
                  Корневой узел
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                Генеральный директор · управляет всей системой задач
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-3 text-center">
              <div>
                <strong className="block text-sm font-semibold">{systemStats.queued}</strong>
                <span className="text-[9px] text-muted-foreground">Ожидают старта</span>
              </div>
              <div>
                <strong className="block text-sm font-semibold text-badge-green">
                  {systemStats.active}
                </strong>
                <span className="text-[9px] text-muted-foreground">В работе</span>
              </div>
              <div>
                <strong className="block text-sm font-semibold">{systemStats.done}</strong>
                <span className="text-[9px] text-muted-foreground">Готово</span>
              </div>
            </div>
          </button>

          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.045] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/70">
                Глобальный проект
              </span>
              {globalProject ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: globalProject.color }}
                  />
                  <span className="truncate text-xs font-semibold">{globalProject.name}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Нет активного проекта</span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-foreground/85">
              <span className="font-semibold text-foreground">Главная цель:</span> {strategicGoal}
            </p>
            {childDepartments.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  Распределение:
                </span>
                {childDepartments.map((department) => (
                  <span
                    key={department.id}
                    className="rounded-full border border-border/70 bg-surface-2/70 px-2 py-0.5 text-[9px] text-muted-foreground"
                  >
                    {department.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </article>

        <div className="relative mx-auto hidden h-[96px] w-full lg:block" aria-hidden="true">
          <svg
            viewBox="0 0 1000 102"
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            <defs>
              <filter id="aiwf-glow">
                <feGaussianBlur stdDeviation="2.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {childDepartments.slice(0, firstRowCount).map((department, index) => {
              const x = childX[index] ?? 500;
              const path = branchPath(x);
              const moving =
                activeTransfer ||
                tasks.some(
                  (task) => task.department_id === department.id && task.status === "in_progress",
                );
              return (
                <g key={department.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke="rgba(42,207,201,.45)"
                    strokeWidth="1.2"
                    filter="url(#aiwf-glow)"
                  />
                  <circle cx={x} cy={childY} r="3" fill="#28d4c9" filter="url(#aiwf-glow)" />
                  {moving && (
                    <circle r="2.3" fill="#5ce9df">
                      <animateMotion
                        dur={`${2.4 + index * 0.3}s`}
                        repeatCount="indefinite"
                        path={path}
                      />
                    </circle>
                  )}
                </g>
              );
            })}
            {initiatorDepartmentIndex >= 0 && (
              <circle r="2.8" fill="#f6c550" filter="url(#aiwf-glow)">
                <animateMotion
                  dur="2.2s"
                  repeatCount="indefinite"
                  path={`M${childX[initiatorDepartmentIndex]} ${childY} V${busY} H500 V${ceoY}`}
                />
              </circle>
            )}
          </svg>
        </div>
        <div className="mx-auto hidden h-6 w-px bg-gradient-to-b from-primary/70 to-primary/10 lg:block" />

        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {childDepartments.map((department) => {
            const departmentTasks = tasks.filter((task) => task.department_id === department.id);
            const departmentAgents = agents.filter(
              (agent) => agent.department_id === department.id && agent.is_active,
            );
            const stats = counts(departmentTasks);
            const departmentProject = currentTask(departmentTasks)?.project_id;
            const isSelected = selectedDepartmentId === department.id;
            return (
              <article
                key={department.id}
                className={cn(
                  "relative rounded-2xl border bg-surface/88 p-2.5 backdrop-blur-xl transition",
                  n === 6 && department === childDepartments[4] && "lg:col-start-2",
                  isSelected
                    ? "border-primary/60 shadow-[0_0_35px_-22px_rgba(35,211,202,.9)]"
                    : "border-border/50 hover:border-primary/35",
                )}
              >
                <button
                  type="button"
                  onClick={() => onDepartmentClick(department)}
                  className="w-full rounded-xl px-1.5 pb-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="grid size-9 place-items-center rounded-full border border-primary/25 bg-primary/8 text-primary">
                      {["Developer", "Engineering", "Chief of Development Department"].includes(
                        department.name,
                      ) ? (
                        <Code2 className="size-4" />
                      ) : ["Marketer", "Business", "Chief Marketing Operation", "CMO"].includes(
                          department.name,
                        ) ? (
                        <Megaphone className="size-4" />
                      ) : department.name === "Research" ? (
                        <Search className="size-4" />
                      ) : department.name === "CEO" ? (
                        <BriefcaseBusiness className="size-4" />
                      ) : (
                        <UsersRound className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">{department.name}</h3>
                      <p className="mt-0.5 truncate text-[10px] text-primary/90">
                        Сейчас:{" "}
                        {departmentProject
                          ? (projectById.get(departmentProject)?.name ?? "Проект")
                          : "ожидает задачу"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "mt-1 size-2 rounded-full",
                        stats.active
                          ? "bg-badge-green shadow-[0_0_10px_rgba(52,211,153,.8)]"
                          : "bg-badge-gray",
                      )}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 divide-x divide-border border-t border-border/70 pt-2 text-center">
                    <div>
                      <strong className="block text-sm font-semibold">{stats.queued}</strong>
                      <span className="text-[9px] text-muted-foreground">Ожидают старта</span>
                    </div>
                    <div>
                      <strong className="block text-sm font-semibold">{stats.active}</strong>
                      <span className="text-[9px] text-muted-foreground">В работе</span>
                    </div>
                    <div>
                      <strong className="block text-sm font-semibold">{stats.done}</strong>
                      <span className="text-[9px] text-muted-foreground">Готово</span>
                    </div>
                  </div>
                </button>

                <div
                  className={cn(
                    "grid gap-1.5",
                    department.name === "Marketer" ||
                      department.name === "Chief Marketing Operation"
                      ? "grid-cols-2 sm:grid-cols-3"
                      : "grid-cols-2",
                  )}
                >
                  {departmentAgents.map((agent) => {
                    const Icon = ROLE_ICONS[agent.role] ?? Bot;
                    const agentTasks = departmentTasks.filter((task) => task.agent_id === agent.id);
                    const activeTask = currentTask(agentTasks);
                    const displayStatus = agentTasks.some((task) =>
                      ["planning", "in_progress"].includes(task.status),
                    )
                      ? "working"
                      : agent.status;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => onAgentClick(agent)}
                        className="h-[5.25rem] overflow-hidden rounded-xl border border-border/80 bg-surface-2/80 p-2 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 text-primary">
                            <Icon className="size-3" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">
                            {agent.role}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-1">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px]",
                              displayStatus === "working"
                                ? "border-badge-green/30 bg-badge-green-bg text-badge-green"
                                : displayStatus === "blocked"
                                  ? "border-badge-red/30 bg-badge-red-bg text-badge-red"
                                  : "border-border text-muted-foreground",
                            )}
                          >
                            <span className="size-1 rounded-full bg-current" />
                            {displayStatus}
                          </span>
                          <span className="text-[8px] text-muted-foreground/70">
                            {agentTasks.length} задач
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-1 text-[9px] leading-4 text-muted-foreground">
                          {activeTask?.title ?? agent.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
