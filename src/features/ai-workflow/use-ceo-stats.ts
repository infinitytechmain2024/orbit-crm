/**
 * Hook for CEO dashboard statistics
 * Aggregates task data for CEO overview
 */

import { useMemo } from "react";
import type { WorkflowTask } from "./types";

export interface CEOStats {
  queued: number;
  inProgress: number;
  done: number;
  pendingApproval: WorkflowTask[];
  total: number;
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  byProject: Record<string, number>;
}

export function useCEOStats(tasks: WorkflowTask[]): CEOStats {
  return useMemo(() => {
    const queued = tasks.filter((t) => ["queued", "planning"].includes(t.status)).length;

    const inProgress = tasks.filter((t) => t.status === "in_progress").length;

    const done = tasks.filter((t) => t.status === "done").length;

    const pendingApproval = tasks.filter((t) => t.status === "approval_required");

    const byPriority = {
      critical: tasks.filter((t) => t.priority === "critical").length,
      high: tasks.filter((t) => t.priority === "high").length,
      medium: tasks.filter((t) => t.priority === "medium").length,
      low: tasks.filter((t) => t.priority === "low").length,
    };

    const byProject: Record<string, number> = {};
    tasks.forEach((t) => {
      const projectId = t.project_id || "unknown";
      byProject[projectId] = (byProject[projectId] || 0) + 1;
    });

    return {
      queued,
      inProgress,
      done,
      pendingApproval,
      total: tasks.length,
      byPriority,
      byProject,
    };
  }, [tasks]);
}
