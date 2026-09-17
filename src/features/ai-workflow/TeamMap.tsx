import { BriefcaseBusiness, ChevronRight } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import {
  TEAM_STATUS_CLASS,
  TEAM_STATUS_LABEL,
  agentTeamStatus,
  departmentIcon,
  departmentTeamStatus,
  groupTeamStatus,
  taskCounts,
  type TeamStatus,
} from "./team-status";
import type { ApprovalRequest, WorkflowAgent, WorkflowDepartment, WorkflowTask } from "./types";

export function TeamMap({
  departments,
  agents,
  tasks,
  approvals,
  selectedDepartmentId,
  lastRealtimeAt,
  onDepartmentClick,
}: {
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tasks: WorkflowTask[];
  approvals: ApprovalRequest[];
  selectedDepartmentId: string;
  lastRealtimeAt: number;
  onDepartmentClick: (department: WorkflowDepartment) => void;
}) {
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

  const statusByDepartment = new Map(
    departments.map((department) => [
      department.id,
      departmentTeamStatus(department, agents, tasks),
    ]),
  );
  // The CEO node is "working" whenever any part of the organisation is.
  const ceoStatus = groupTeamStatus([...statusByDepartment.values()]);

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
        {ceoDepartment && (
          <TeamCard
            icon={BriefcaseBusiness}
            name="CEO"
            status={ceoStatus}
            openTasks={taskCounts(tasks).open}
            workingMembers={
              childDepartments.filter(
                (department) => statusByDepartment.get(department.id) === "working",
              ).length
            }
            memberNoun={["отдел", "отдела", "отделов"]}
            selected={selectedDepartmentId === ceoDepartment.id}
            accent="ceo"
            onClick={() => onDepartmentClick(ceoDepartment)}
          />
        )}

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

        <div
          className={cn(
            "mt-3 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:mt-0",
            LG_COLUMNS[firstRowCount] ?? "lg:grid-cols-4",
          )}
        >
          {childDepartments.map((department) => {
            const departmentTasks = tasks.filter((task) => task.department_id === department.id);
            const workingAgents = agents.filter(
              (agent) =>
                agent.department_id === department.id &&
                agent.is_active &&
                agentTeamStatus(
                  agent,
                  departmentTasks.filter((task) => task.agent_id === agent.id),
                ) === "working",
            ).length;
            return (
              <TeamCard
                key={department.id}
                icon={departmentIcon(department)}
                name={department.name}
                status={statusByDepartment.get(department.id) ?? "idle"}
                openTasks={taskCounts(departmentTasks).open}
                workingMembers={workingAgents}
                memberNoun={["агент", "агента", "агентов"]}
                selected={selectedDepartmentId === department.id}
                className={cn(n === 6 && department === childDepartments[4] && "lg:col-start-2")}
                onClick={() => onDepartmentClick(department)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Match the grid to the connector branches so every card sits under its line.
const LG_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

function plural(count: number, [one, few, many]: [string, string, string]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function TeamCard({
  icon: Icon,
  name,
  status,
  openTasks,
  workingMembers,
  memberNoun,
  selected,
  accent,
  className,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  name: string;
  status: TeamStatus;
  openTasks: number;
  workingMembers: number;
  memberNoun: [string, string, string];
  selected: boolean;
  accent?: "ceo";
  className?: string | undefined;
  onClick: () => void;
}) {
  const isCeo = accent === "ceo";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full flex-col gap-2.5 rounded-2xl border p-3 text-left backdrop-blur-xl transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isCeo
          ? "mx-auto max-w-sm bg-gradient-to-b from-amber-500/10 to-surface/88"
          : "h-full bg-surface/88",
        isCeo
          ? selected
            ? "border-badge-yellow/60 shadow-[0_0_45px_-18px_rgba(245,158,11,.85)]"
            : "border-badge-yellow/30 shadow-[0_0_40px_-22px_rgba(245,158,11,.7)] hover:border-badge-yellow/45"
          : selected
            ? "border-primary/60 shadow-[0_0_35px_-22px_rgba(35,211,202,.9)]"
            : "border-border/50 hover:border-primary/35",
        className,
      )}
    >
      <span className="flex w-full items-center gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full border",
            isCeo
              ? "border-badge-yellow/35 bg-badge-yellow-bg text-badge-yellow"
              : "border-primary/25 bg-primary/8 text-primary",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5" title={name}>
          {name}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </span>
      <span className="mt-auto flex w-full items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium",
            TEAM_STATUS_CLASS[status],
          )}
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full bg-current",
              status === "working" && "animate-pulse",
            )}
          />
          <span className="truncate">
            {TEAM_STATUS_LABEL[status]}
            {status === "working" && workingMembers > 0 && (
              <span className="opacity-75">
                {" "}
                · {workingMembers} {plural(workingMembers, memberNoun)}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          <strong className="font-semibold text-foreground">{openTasks}</strong>{" "}
          {plural(openTasks, ["задача", "задачи", "задач"])}
        </span>
      </span>
    </button>
  );
}
