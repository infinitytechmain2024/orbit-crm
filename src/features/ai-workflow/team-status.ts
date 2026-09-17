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

import type { WorkflowAgent, WorkflowDepartment, WorkflowTask } from "./types";

type IconComponent = ComponentType<{ className?: string }>;

const ROLE_ICONS: Record<string, IconComponent> = {
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

export function agentIcon(agent: WorkflowAgent): IconComponent {
  return ROLE_ICONS[agent.role] ?? Bot;
}

export function departmentIcon(department: WorkflowDepartment): IconComponent {
  if (["Developer", "Engineering", "Chief of Development Department"].includes(department.name))
    return Code2;
  if (["Marketer", "Business", "Chief Marketing Operation", "CMO"].includes(department.name))
    return Megaphone;
  if (department.name === "Research") return Search;
  if (department.name === "CEO") return BriefcaseBusiness;
  return UsersRound;
}

const ACTIVE_STATUSES = new Set(["planning", "in_progress", "review", "revisions_requested"]);
const CLOSED_STATUSES = new Set(["done", "cancelled"]);

export function isActiveTask(task: WorkflowTask) {
  return ACTIVE_STATUSES.has(task.status);
}

export function isClosedTask(task: WorkflowTask) {
  return CLOSED_STATUSES.has(task.status);
}

export function taskCounts(tasks: WorkflowTask[]) {
  return {
    queued: tasks.filter((task) => task.status === "queued").length,
    active: tasks.filter(isActiveTask).length,
    done: tasks.filter((task) => task.status === "done").length,
    open: tasks.filter((task) => !isClosedTask(task)).length,
  };
}

export type TeamStatus = "working" | "approval" | "blocked" | "idle";

export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  working: "В работе",
  approval: "Ждёт утверждения",
  blocked: "Заблокирован",
  idle: "Ожидает задачу",
};

export const TEAM_STATUS_CLASS: Record<TeamStatus, string> = {
  working: "border-badge-green/30 bg-badge-green-bg text-badge-green",
  approval: "border-badge-yellow/30 bg-badge-yellow-bg text-badge-yellow",
  blocked: "border-badge-red/30 bg-badge-red-bg text-badge-red",
  idle: "border-border text-muted-foreground",
};

/** A group is working as soon as any one of its members is working. */
export function groupTeamStatus(statuses: TeamStatus[]): TeamStatus {
  for (const status of ["working", "approval", "blocked"] as const) {
    if (statuses.includes(status)) return status;
  }
  return "idle";
}

export function tasksTeamStatus(tasks: WorkflowTask[]): TeamStatus {
  if (tasks.some(isActiveTask)) return "working";
  if (tasks.some((task) => task.status === "approval_required")) return "approval";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  return "idle";
}

export function agentTeamStatus(agent: WorkflowAgent, agentTasks: WorkflowTask[]): TeamStatus {
  const stored: TeamStatus =
    agent.status === "working" ? "working" : agent.status === "blocked" ? "blocked" : "idle";
  return groupTeamStatus([tasksTeamStatus(agentTasks), stored]);
}

/** Department status rolls up its agents plus any department tasks without an agent. */
export function departmentTeamStatus(
  department: WorkflowDepartment,
  agents: WorkflowAgent[],
  tasks: WorkflowTask[],
): TeamStatus {
  const departmentTasks = tasks.filter((task) => task.department_id === department.id);
  const agentStatuses = agents
    .filter((agent) => agent.department_id === department.id && agent.is_active)
    .map((agent) =>
      agentTeamStatus(
        agent,
        departmentTasks.filter((task) => task.agent_id === agent.id),
      ),
    );
  return groupTeamStatus([...agentStatuses, tasksTeamStatus(departmentTasks)]);
}
