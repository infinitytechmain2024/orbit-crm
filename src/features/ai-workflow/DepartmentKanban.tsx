/**
 * Department Kanban Board
 * Shows tasks for a specific department in kanban view
 */

import { useMemo } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkflowAgent, WorkflowDepartment, WorkflowTask, WorkflowTaskStatus } from "./types";

const COLUMN_CONFIG: Array<{
  status: WorkflowTaskStatus[];
  title: string;
  color: string;
}> = [
  {
    status: ["planning", "queued"],
    title: "Очередь",
    color: "text-muted-foreground",
  },
  {
    status: ["in_progress"],
    title: "В работе",
    color: "text-cyan-400",
  },
  {
    status: ["review", "approval_required"],
    title: "Проверка",
    color: "text-violet-400",
  },
  {
    status: ["done"],
    title: "Готово",
    color: "text-badge-green",
  },
];

interface DepartmentKanbanProps {
  department: WorkflowDepartment;
  tasks: WorkflowTask[];
  agents: WorkflowAgent[];
  onBack: () => void;
  onTaskClick: (task: WorkflowTask) => void;
  onStatusChange: (task: WorkflowTask, status: WorkflowTaskStatus) => void;
}

export function DepartmentKanban({
  department,
  tasks,
  agents,
  onBack,
  onTaskClick,
  onStatusChange,
}: DepartmentKanbanProps) {
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const columns = useMemo(() => {
    return COLUMN_CONFIG.map((column) => ({
      ...column,
      tasks: tasks.filter((task) => column.status.includes(task.status)),
    }));
  }, [tasks]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-border p-2 hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: department.color }} />
          <h2 className="text-lg font-semibold">{department.name}</h2>
        </div>
        <span className="text-sm text-muted-foreground">{tasks.length} задач</span>
      </div>

      {/* Kanban Columns */}
      <div className="grid grid-cols-4 gap-4">
        {columns.map((column) => (
          <div key={column.title} className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className={cn("text-sm font-medium", column.color)}>{column.title}</h3>
              <span className="text-xs text-muted-foreground">{column.tasks.length}</span>
            </div>

            <div className="space-y-2">
              {column.tasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Нет задач
                </div>
              ) : (
                column.tasks.map((task) => {
                  const agent = task.agent_id ? agentById.get(task.agent_id) : null;

                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onTaskClick(task)}
                      className={cn(
                        "w-full rounded-lg border border-border bg-card p-3 text-left transition-all",
                        "hover:border-primary/30 hover:shadow-md",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium line-clamp-2">{task.title}</span>
                        {task.status === "in_progress" && (
                          <Loader2 className="h-3 w-3 animate-spin text-cyan-400 flex-shrink-0" />
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[8px] font-medium",
                            task.priority === "critical"
                              ? "bg-red-500/20 text-red-400"
                              : task.priority === "high"
                                ? "bg-orange-500/20 text-orange-400"
                                : task.priority === "medium"
                                  ? "bg-yellow-500/20 text-yellow-400"
                                  : "bg-green-500/20 text-green-400",
                          )}
                        >
                          {task.priority}
                        </span>
                        {agent && (
                          <span className="text-[9px] text-muted-foreground truncate">
                            {agent.name}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
