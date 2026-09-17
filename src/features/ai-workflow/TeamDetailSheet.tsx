import { useMemo, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, ChevronRight, ListFilter, UserCog } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_SORT_ORDER, statusClass } from "./TasksTable";
import {
  TEAM_STATUS_CLASS,
  TEAM_STATUS_LABEL,
  agentIcon,
  agentTeamStatus,
  departmentIcon,
  departmentTeamStatus,
  groupTeamStatus,
  isClosedTask,
  taskCounts,
  type TeamStatus,
} from "./team-status";
import type { WorkflowAgent, WorkflowDepartment, WorkflowProject, WorkflowTask } from "./types";

/** Which node of the team tree the sheet shows; drilling in pushes, "back" pops. */
export type TeamNode = { kind: "department"; id: string } | { kind: "agent"; id: string };

const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

type Member = {
  key: string;
  node: TeamNode;
  icon: ComponentType<{ className?: string }>;
  name: string;
  status: TeamStatus;
  counts: ReturnType<typeof taskCounts>;
};

export function TeamDetailSheet({
  stack,
  departments,
  agents,
  tasks,
  projects,
  onStackChange,
  onTaskOpen,
  onAgentProfile,
  onShowInTable,
}: {
  stack: TeamNode[];
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tasks: WorkflowTask[];
  projects: WorkflowProject[];
  onStackChange: (stack: TeamNode[]) => void;
  onTaskOpen: (task: WorkflowTask) => void;
  onAgentProfile: (agent: WorkflowAgent) => void;
  onShowInTable: (department: WorkflowDepartment) => void;
}) {
  const node = stack.at(-1);
  const parent = stack.at(-2);
  const departmentById = useMemo(
    () => new Map(departments.map((department) => [department.id, department])),
    [departments],
  );
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const ceoDepartment =
    departments.find((department) => department.name === "CEO") ?? departments[0];

  const view = useMemo(() => {
    if (!node) return null;
    if (node.kind === "agent") {
      const agent = agentById.get(node.id);
      if (!agent) return null;
      const scopedTasks = tasks.filter((task) => task.agent_id === agent.id);
      return {
        title: agent.role,
        icon: agentIcon(agent),
        isCeo: false,
        status: agentTeamStatus(agent, scopedTasks),
        tasks: scopedTasks,
        members: [] as Member[],
        membersTitle: "",
        agent,
        department: undefined,
      };
    }

    const department = departmentById.get(node.id);
    if (!department) return null;
    const isCeo = department.id === ceoDepartment?.id;
    const ownAgents = agents.filter(
      (agent) => agent.department_id === department.id && agent.is_active,
    );
    const agentMembers: Member[] = ownAgents.map((agent) => {
      const agentTasks = tasks.filter((task) => task.agent_id === agent.id);
      return {
        key: agent.id,
        node: { kind: "agent", id: agent.id },
        icon: agentIcon(agent),
        name: agent.role,
        status: agentTeamStatus(agent, agentTasks),
        counts: taskCounts(agentTasks),
      };
    });

    if (isCeo) {
      // The CEO oversees every department, so its sub-agents are the departments themselves.
      const departmentMembers: Member[] = departments
        .filter((item) => item.id !== department.id)
        .map((item) => ({
          key: item.id,
          node: { kind: "department", id: item.id },
          icon: departmentIcon(item),
          name: item.name,
          status: departmentTeamStatus(item, agents, tasks),
          counts: taskCounts(tasks.filter((task) => task.department_id === item.id)),
        }));
      const members = [...departmentMembers, ...agentMembers.filter((m) => m.name !== "CEO")];
      return {
        title: "CEO",
        icon: BriefcaseBusiness,
        isCeo,
        status: groupTeamStatus(members.map((member) => member.status)),
        tasks,
        members,
        membersTitle: "Отделы",
        agent: undefined,
        department,
      };
    }

    const scopedTasks = tasks.filter((task) => task.department_id === department.id);
    return {
      title: department.name,
      icon: departmentIcon(department),
      isCeo,
      status: departmentTeamStatus(department, agents, tasks),
      tasks: scopedTasks,
      members: agentMembers,
      membersTitle: "Агенты отдела",
      agent: undefined,
      department,
    };
  }, [agentById, agents, ceoDepartment?.id, departmentById, departments, node, tasks]);

  const parentName = parent
    ? parent.kind === "agent"
      ? agentById.get(parent.id)?.role
      : departmentById.get(parent.id)?.id === ceoDepartment?.id
        ? "CEO"
        : departmentById.get(parent.id)?.name
    : undefined;

  return (
    <Sheet
      open={Boolean(view)}
      onOpenChange={(open) => {
        if (!open) onStackChange([]);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden border-border bg-surface p-0 sm:max-w-md"
      >
        {view && (
          <>
            <SheetHeader className="space-y-0 border-b border-border/70 px-5 pb-4 pt-5 text-left">
              {parent && (
                <button
                  type="button"
                  onClick={() => onStackChange(stack.slice(0, -1))}
                  className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowLeft className="size-3.5" /> {parentName ?? "Назад"}
                </button>
              )}
              <div className="flex items-center gap-3 pr-6">
                <span
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-full border",
                    view.isCeo
                      ? "border-badge-yellow/35 bg-badge-yellow-bg text-badge-yellow"
                      : "border-primary/25 bg-primary/8 text-primary",
                  )}
                >
                  <view.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{view.title}</SheetTitle>
                  <SheetDescription asChild>
                    <div className="mt-1">
                      <StatusPill status={view.status} />
                    </div>
                  </SheetDescription>
                </div>
              </div>
              <StatGrid counts={taskCounts(view.tasks)} className="mt-4" />
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 [&>*]:shrink-0">
              {view.members.length > 0 && (
                <section>
                  <SectionTitle>{view.membersTitle}</SectionTitle>
                  <div className="mt-2 space-y-1.5">
                    {view.members.map((member) => (
                      <MemberRow
                        key={member.key}
                        member={member}
                        onClick={() => onStackChange([...stack, member.node])}
                      />
                    ))}
                  </div>
                </section>
              )}

              {view.isCeo && <CeoFocus tasks={view.tasks} projectById={projectById} />}

              <TaskLists
                key={`${node?.kind}:${node?.id}`}
                tasks={view.tasks}
                projectById={projectById}
                agentById={agentById}
                showAgent={!view.agent}
                onTaskOpen={onTaskOpen}
              />
            </div>

            {(view.agent || (view.department && !view.isCeo)) && (
              <div className="flex gap-2 border-t border-border/70 px-5 py-3">
                {view.agent && (
                  <button
                    type="button"
                    onClick={() => view.agent && onAgentProfile(view.agent)}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-border text-xs hover:border-primary/50 hover:text-primary"
                  >
                    <UserCog className="size-4" /> Профиль и назначение
                  </button>
                )}
                {view.department && !view.isCeo && (
                  <button
                    type="button"
                    onClick={() => view.department && onShowInTable(view.department)}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-border text-xs hover:border-primary/50 hover:text-primary"
                  >
                    <ListFilter className="size-4" /> Показать в таблице задач
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StatusPill({ status }: { status: TeamStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium",
        TEAM_STATUS_CLASS[status],
      )}
    >
      <span
        className={cn("size-1.5 rounded-full bg-current", status === "working" && "animate-pulse")}
      />
      {TEAM_STATUS_LABEL[status]}
    </span>
  );
}

function StatGrid({
  counts,
  className,
}: {
  counts: ReturnType<typeof taskCounts>;
  className?: string;
}) {
  const cells = [
    { label: "Ожидают старта", value: counts.queued, tone: "" },
    { label: "В работе", value: counts.active, tone: "text-badge-green" },
    { label: "Готово", value: counts.done, tone: "" },
  ];
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="rounded-xl border border-border/70 bg-surface-2/60 px-2 py-2 text-center"
        >
          <strong className={cn("block text-lg font-semibold leading-tight", cell.tone)}>
            {cell.value}
          </strong>
          <span className="text-[10px] text-muted-foreground">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function MemberRow({ member, onClick }: { member: Member; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-xl border border-border/70 bg-surface-2/60 p-2.5 sm:gap-2.5 text-left transition hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 text-primary">
        <member.icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold" title={member.name}>
          {member.name}
        </span>
        <span className="mt-1 block">
          <StatusPill status={member.status} />
        </span>
      </span>
      <span className="grid shrink-0 grid-cols-3 gap-0.5 text-center sm:gap-2.5">
        <MiniCount value={member.counts.queued} label="Ждут" />
        <MiniCount value={member.counts.active} label="В работе" tone="text-badge-green" />
        <MiniCount value={member.counts.done} label="Готово" />
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function MiniCount({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <span className="w-10 sm:w-12">
      <strong className={cn("block text-xs font-semibold", value > 0 && tone)}>{value}</strong>
      <span className="block whitespace-nowrap text-[9px] leading-3 text-muted-foreground">
        {label}
      </span>
    </span>
  );
}

function CeoFocus({
  tasks,
  projectById,
}: {
  tasks: WorkflowTask[];
  projectById: Map<string, WorkflowProject>;
}) {
  const goal = tasks
    .filter((task) => !task.parent_task_id && !isClosedTask(task))
    .sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))[0];
  if (!goal) return null;
  const project = goal.project_id ? projectById.get(goal.project_id) : undefined;
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/[0.045] p-3">
      <SectionTitle>Главная цель</SectionTitle>
      <p className="mt-1.5 text-xs leading-5">{goal.title}</p>
      {project && (
        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: project.color }} />
          {project.name}
        </p>
      )}
    </section>
  );
}

function TaskLists({
  tasks,
  projectById,
  agentById,
  showAgent,
  onTaskOpen,
}: {
  tasks: WorkflowTask[];
  projectById: Map<string, WorkflowProject>;
  agentById: Map<string, WorkflowAgent>;
  showAgent: boolean;
  onTaskOpen: (task: WorkflowTask) => void;
}) {
  const [tab, setTab] = useState<"current" | "history">("current");
  const current = tasks
    .filter((task) => !isClosedTask(task))
    .sort(
      (a, b) =>
        STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status] ||
        (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0),
    );
  const history = tasks
    .filter(isClosedTask)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const list = tab === "current" ? current : history;

  return (
    <section>
      <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-surface-2/50 p-1">
        {(
          [
            ["current", "Задачи", current.length],
            ["history", "История", history.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs transition",
              tab === value
                ? "bg-primary/15 font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            <span className="rounded-full bg-surface px-1.5 text-[10px] tabular-nums">{count}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 space-y-1.5">
        {list.map((task) => {
          const project = task.project_id ? projectById.get(task.project_id) : undefined;
          const agent = task.agent_id ? agentById.get(task.agent_id) : undefined;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onTaskOpen(task)}
              className="flex w-full flex-col gap-1 rounded-xl border border-border/60 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-xs font-medium leading-5">{task.title}</span>
                <span className={cn("shrink-0 text-[10px] font-medium", statusClass(task.status))}>
                  {STATUS_LABEL[task.status]}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                {project && (
                  <>
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="truncate">{project.name}</span>
                  </>
                )}
                {showAgent && agent && (
                  <span className="truncate">
                    {project && "· "}
                    {agent.role}
                  </span>
                )}
                <time className="ml-auto shrink-0">
                  {new Date(task.updated_at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </span>
            </button>
          );
        })}
        {!list.length && (
          <p className="rounded-xl border border-dashed border-border/70 p-4 text-center text-[11px] text-muted-foreground">
            {tab === "current" ? "Открытых задач нет" : "Завершённых задач пока нет"}
          </p>
        )}
      </div>
    </section>
  );
}
