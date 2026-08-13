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
  const commanderDepartments = ["Engineering", "Research", "Operations", "Business"];
  const legacyDepartments = [
    "CEO",
    "Chief of Development Department",
    "Chief Marketing Operation",
    "HR",
  ];
  const departmentOrder = departments.some((item) => commanderDepartments.includes(item.name))
    ? commanderDepartments
    : legacyDepartments;
  const orderedDepartments = departmentOrder
    .map((name) => departments.find((department) => department.name === name))
    .filter((department): department is WorkflowDepartment => Boolean(department));
  const initiatorDepartmentIndex = orderedDepartments.findIndex(
    (department) => department.id === initiator?.department_id,
  );
  const gridColumns = 4;
  const nodeX = orderedDepartments.map((_, index) =>
    Math.round(((index + 0.5) / gridColumns) * 1000),
  );

  return (
    <section aria-label="Карта AI-команды" className="relative">
      <div className="relative mx-auto hidden h-10 max-w-5xl lg:block" aria-hidden="true">
        <svg
          viewBox="0 0 1000 40"
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
          {nodeX.map((x, index) => {
            const path = `M500 0 V12 H${x} Q${x - (x < 500 ? 10 : -10)} 12 ${x} 21 V40`;
            const department = orderedDepartments[index];
            const moving =
              Boolean(
                department &&
                tasks.some(
                  (task) => task.department_id === department.id && task.status === "in_progress",
                ),
              ) || activeTransfer;
            return (
              <g key={x}>
                <path
                  d={path}
                  fill="none"
                  stroke="rgba(42,207,201,.5)"
                  strokeWidth="1.2"
                  filter="url(#aiwf-glow)"
                />
                <circle cx={x} cy="40" r="3" fill="#28d4c9" filter="url(#aiwf-glow)" />
                {moving && (
                  <circle r="2.3" fill="#5ce9df">
                    <animateMotion
                      dur={`${2.5 + index * 0.35}s`}
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
                path={`M${nodeX[initiatorDepartmentIndex] ?? 500} 40 V21 Q${nodeX[initiatorDepartmentIndex] ?? 500} 12 ${(nodeX[initiatorDepartmentIndex] ?? 500) + ((nodeX[initiatorDepartmentIndex] ?? 500) < 500 ? 10 : -10)} 12 H500 V0`}
              />
            </circle>
          )}
        </svg>
      </div>
      <div className="mx-auto h-6 w-px bg-gradient-to-b from-primary/70 to-primary/10 lg:hidden" />

      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {orderedDepartments.map((department) => {
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
                "rounded-2xl border bg-[#0b1925]/88 p-2.5 backdrop-blur-xl transition",
                isSelected
                  ? "border-primary/60 shadow-[0_0_35px_-22px_rgba(35,211,202,.9)]"
                  : "border-[#254252]/75 hover:border-primary/35",
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
                        ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]"
                        : "bg-slate-500",
                    )}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 divide-x divide-border border-t border-border/70 pt-2 text-center">
                  <div>
                    <strong className="block text-sm font-semibold">{stats.queued}</strong>
                    <span className="text-[9px] text-muted-foreground">В очереди</span>
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
                  department.name === "Marketer" || department.name === "Chief Marketing Operation"
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
                      className="h-[5.25rem] overflow-hidden rounded-xl border border-border/80 bg-[#0c1d2a]/80 p-2 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#103b56] to-[#122841] text-[#35c9f4]">
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
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                              : displayStatus === "blocked"
                                ? "border-red-400/30 bg-red-400/10 text-red-300"
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
    </section>
  );
}
