/**
 * AI Workflow Integration Component
 * Brings together all workflow components with live backend status
 */

import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  ApprovalRequest,
  WorkflowAgent,
  WorkflowDepartment,
  WorkflowProject,
  WorkflowTask,
  WorkflowTaskStatus,
} from "./types";
import { useBackendStatus } from "./use-backend-status";
import { useWorkflowControls } from "./use-workflow-controls";
import { useWorkflowProgress } from "./use-workflow-progress";
import { useCEOStats } from "./use-ceo-stats";
import { DepartmentKanban } from "./DepartmentKanban";
import { TeamMap } from "./TeamMap";
import { CancelConfirmDialog } from "@/components/ai-workflow/CancelConfirmDialog";

interface AIWorkflowIntegrationProps {
  departments: WorkflowDepartment[];
  agents: WorkflowAgent[];
  tasks: WorkflowTask[];
  projects: WorkflowProject[];
  approvals: ApprovalRequest[];
  lastRealtimeAt: number;
  onRefresh: () => void;
  accessToken?: string;
  organizationId?: string;
  onUpdate: (taskId: string, patch: Partial<WorkflowTask>) => void;
}

export function AIWorkflowIntegration({
  departments,
  agents,
  tasks,
  projects,
  approvals,
  lastRealtimeAt,
  onRefresh,
  accessToken,
  organizationId,
  onUpdate,
}: AIWorkflowIntegrationProps) {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<WorkflowTask | null>(null);
  const [cancelConfirmTask, setCancelConfirmTask] = useState<WorkflowTask | null>(null);

  const backendStatus = useBackendStatus();
  const workflowControls = useWorkflowControls(accessToken, organizationId, onUpdate);
  const workflowProgress = useWorkflowProgress(tasks);
  const ceoStats = useCEOStats(tasks);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === selectedDepartmentId),
    [departments, selectedDepartmentId],
  );

  const departmentTasks = useMemo(
    () => tasks.filter((t) => t.department_id === selectedDepartmentId),
    [tasks, selectedDepartmentId],
  );

  const handleDepartmentClick = useCallback((department: WorkflowDepartment) => {
    setSelectedDepartmentId(department.id);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedDepartmentId("");
  }, []);

  const handleTaskClick = useCallback((task: WorkflowTask) => {
    setSelectedTask(task);
  }, []);

  const handleStatusChange = useCallback(
    async (task: WorkflowTask, newStatus: WorkflowTaskStatus) => {
      onUpdate(task.id, { status: newStatus });
    },
    [onUpdate],
  );

  const handleControl = useCallback(
    async (task: WorkflowTask, action: "pause" | "resume" | "retry" | "cancel") => {
      if (action === "cancel") {
        setCancelConfirmTask(task);
        return;
      }
      switch (action) {
        case "pause":
          await workflowControls.pauseTask(task);
          break;
        case "resume":
          await workflowControls.resumeTask(task);
          break;
        case "retry":
          await workflowControls.retryTask(task);
          break;
      }
    },
    [workflowControls],
  );

  const handleCancelConfirm = useCallback(async () => {
    if (cancelConfirmTask) {
      await workflowControls.cancelTask(cancelConfirmTask);
      setCancelConfirmTask(null);
    }
  }, [cancelConfirmTask, workflowControls]);

  return (
    <div className="space-y-6">
      {/* Backend Status Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
              backendStatus.status === "online"
                ? "bg-badge-green-bg text-badge-green border border-badge-green/20"
                : backendStatus.status === "checking"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20",
            )}
          >
            {backendStatus.status === "online" ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : backendStatus.status === "checking" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            )}
            {backendStatus.isDemoMode
              ? "Demo Mode"
              : backendStatus.status === "online"
                ? "Backend Online"
                : backendStatus.status === "checking"
                  ? "Checking..."
                  : backendStatus.status === "warming"
                    ? "Server waking up"
                    : "Backend Offline"}
          </div>

          {(backendStatus.status === "offline" || backendStatus.status === "warming") && (
            <button
              type="button"
              onClick={() => void backendStatus.retry()}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {backendStatus.status === "warming" ? "Check again" : "Retry"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          {tasks.filter((t) => t.status === "in_progress").length} active tasks
        </div>
      </div>

      {/* Department View or Kanban */}
      {selectedDepartment ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleBackToList}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Team Map
          </button>

          <DepartmentKanban
            department={selectedDepartment}
            tasks={departmentTasks}
            agents={agents.filter((a) => a.department_id === selectedDepartmentId)}
            onBack={handleBackToList}
            onTaskClick={handleTaskClick}
            onStatusChange={handleStatusChange}
          />
        </div>
      ) : (
        <TeamMap
          departments={departments}
          agents={agents}
          tasks={tasks}
          projects={projects}
          approvals={approvals}
          selectedDepartmentId={selectedDepartmentId}
          selectedProjectId={selectedProjectId}
          lastRealtimeAt={lastRealtimeAt}
          onDepartmentClick={handleDepartmentClick}
          onAgentClick={(agent) => {
            if (agent.department_id) {
              setSelectedDepartmentId(agent.department_id);
            }
          }}
          onApprove={(task) => {
            void workflowControls.resumeTask(task);
          }}
          onReject={(task) => {
            void workflowControls.cancelTask(task);
          }}
        />
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="Departments"
          value={departments.length}
          color="text-primary"
        />
        <StatCard
          icon={Bot}
          label="Active Agents"
          value={agents.filter((a) => a.status === "working").length}
          color="text-badge-green"
        />
        <StatCard
          icon={Zap}
          label="In Progress"
          value={ceoStats.inProgress}
          color="text-cyan-400"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={ceoStats.done}
          color="text-violet-400"
        />
      </div>

      {/* Cancel Confirmation Dialog */}
      <CancelConfirmDialog
        open={!!cancelConfirmTask}
        taskTitle={cancelConfirmTask?.title ?? ""}
        onConfirm={handleCancelConfirm}
        onCancel={() => setCancelConfirmTask(null)}
      />

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          agents={agents}
          onClose={() => setSelectedTask(null)}
          onControl={handleControl}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className={cn("rounded-lg bg-muted p-2", color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}

function TaskDetailModal({
  task,
  agents,
  onClose,
  onControl,
}: {
  task: WorkflowTask;
  agents: WorkflowAgent[];
  onClose: () => void;
  onControl: (task: WorkflowTask, action: "pause" | "resume" | "retry" | "cancel") => void;
}) {
  const agent = task.agent_id ? agents.find((a) => a.id === task.agent_id) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate">{task.title}</h3>
            {task.description && (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{task.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border p-2 hover:bg-muted"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Status:</span>
            <span className="ml-2 font-medium">{task.status}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Priority:</span>
            <span className="ml-2 font-medium">{task.priority}</span>
          </div>
          {agent && (
            <div>
              <span className="text-muted-foreground">Assigned:</span>
              <span className="ml-2 font-medium">{agent.name}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Created:</span>
            <span className="ml-2 font-medium">
              {new Date(task.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          {task.status === "in_progress" ? (
            <button
              type="button"
              onClick={() => onControl(task, "pause")}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              <Clock className="h-4 w-4" />
              Pause
            </button>
          ) : task.status === "paused" ? (
            <button
              type="button"
              onClick={() => onControl(task, "resume")}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              <Play className="h-4 w-4" />
              Resume
            </button>
          ) : null}
          {!["done", "cancelled"].includes(task.status) && (
            <button
              type="button"
              onClick={() => onControl(task, "cancel")}
              className="flex items-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
