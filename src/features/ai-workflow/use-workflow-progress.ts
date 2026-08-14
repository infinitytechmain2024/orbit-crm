/**
 * Hook for calculating workflow progress
 * Calculates real progress based on completed tasks
 */

import { useMemo } from "react";
import type { WorkflowTask } from "./types";

export interface WorkflowProgress {
  progress: number;
  total: number;
  completed: number;
  inProgress: number;
  queued: number;
  blocked: number;
  approvalRequired: number;
  isComplete: boolean;
}

export function useWorkflowProgress(tasks: WorkflowTask[]): WorkflowProgress {
  return useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "done").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const queued = tasks.filter(
      (t) => t.status === "queued" || t.status === "planning"
    ).length;
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const approvalRequired = tasks.filter(
      (t) => t.status === "approval_required"
    ).length;

    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      progress,
      total,
      completed,
      inProgress,
      queued,
      blocked,
      approvalRequired,
      isComplete: progress === 100,
    };
  }, [tasks]);
}