/**
 * Hook for workflow control operations (Pause, Resume, Cancel)
 * Sends real API requests to backend
 */

import { useState, useCallback } from "react";
import { authenticatedFetch } from "@/lib/api-client";
import type { WorkflowTask, WorkflowTaskStatus } from "./types";

export interface UseWorkflowControlsReturn {
  pauseTask: (task: WorkflowTask) => Promise<void>;
  resumeTask: (task: WorkflowTask) => Promise<void>;
  cancelTask: (task: WorkflowTask) => Promise<void>;
  retryTask: (task: WorkflowTask) => Promise<void>;
  isOperating: boolean;
  error: string | null;
}

export function useWorkflowControls(
  accessToken: string | undefined,
  organizationId: string | undefined,
  onUpdate: (taskId: string, patch: Partial<WorkflowTask>) => void,
): UseWorkflowControlsReturn {
  const [isOperating, setIsOperating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makeRequest = useCallback(
    async (taskId: string, action: string): Promise<boolean> => {
      if (!accessToken || !organizationId) {
        setError("Сессия не активна");
        return false;
      }

      setIsOperating(true);
      setError(null);

      try {
        const response = await authenticatedFetch(
          `/api/backend/api/ai-workflow/tasks/${taskId}/${action}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ organization_id: organizationId }),
          },
        );

        if (!response.ok) {
          throw new Error(`Ошибка: ${response.statusText}`);
        }

        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
        return false;
      } finally {
        setIsOperating(false);
      }
    },
    [accessToken, organizationId],
  );

  const getStatusForAction = (action: string): WorkflowTaskStatus => {
    const statusMap: Record<string, WorkflowTaskStatus> = {
      pause: "paused",
      resume: "in_progress",
      retry: "queued",
      cancel: "cancelled",
    };
    return statusMap[action] || "queued";
  };

  const pauseTask = useCallback(
    async (task: WorkflowTask) => {
      const success = await makeRequest(task.id, "pause");
      if (success) {
        onUpdate(task.id, {
          status: getStatusForAction("pause"),
          updated_at: new Date().toISOString(),
        });
      }
    },
    [makeRequest, onUpdate],
  );

  const resumeTask = useCallback(
    async (task: WorkflowTask) => {
      const success = await makeRequest(task.id, "resume");
      if (success) {
        onUpdate(task.id, {
          status: getStatusForAction("resume"),
          updated_at: new Date().toISOString(),
        });
      }
    },
    [makeRequest, onUpdate],
  );

  const cancelTask = useCallback(
    async (task: WorkflowTask) => {
      const success = await makeRequest(task.id, "cancel");
      if (success) {
        onUpdate(task.id, {
          status: getStatusForAction("cancel"),
          updated_at: new Date().toISOString(),
        });
      }
    },
    [makeRequest, onUpdate],
  );

  const retryTask = useCallback(
    async (task: WorkflowTask) => {
      const success = await makeRequest(task.id, "retry");
      if (success) {
        onUpdate(task.id, {
          status: getStatusForAction("retry"),
          updated_at: new Date().toISOString(),
        });
      }
    },
    [makeRequest, onUpdate],
  );

  return {
    pauseTask,
    resumeTask,
    cancelTask,
    retryTask,
    isOperating,
    error,
  };
}
