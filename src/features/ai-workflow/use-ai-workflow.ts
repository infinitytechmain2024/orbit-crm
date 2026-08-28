import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase/client";
import { fetchWorkflowOverview } from "./api";
import { createEmptyOverview, createDemoOverview } from "./demo-data";
import type { WorkflowOverview, WorkflowTask } from "./types";

export function useAiWorkflow(
  accessToken: string | undefined,
  organizationId: string | undefined,
  projectId: string,
  preview = false,
) {
  const [overview, setOverview] = useState<WorkflowOverview>(() => createEmptyOverview());
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRealtimeConnected, setRealtimeConnected] = useState(false);
  const [lastRealtimeAt, setLastRealtimeAt] = useState(0);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (quiet = false) => {
      if (preview) {
        setOverview(createDemoOverview(projectId));
        setIsLoading(false);
        setIsRefreshing(false);
        setIsRecovering(false);
        setError(null);
        return;
      }
      if (!accessToken || !organizationId) return;
      if (quiet) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const data = await fetchWorkflowOverview(
          accessToken,
          organizationId,
          projectId === "all" ? undefined : projectId,
        );
        setOverview(data);
        setError(null);
        setIsRecovering(false);
      } catch (unknownError) {
        const message =
          unknownError instanceof Error ? unknownError.message : "Не удалось загрузить AI Workflow";
        const transient = /502|503|waking up|просып|failed to fetch|backend is unavailable/i.test(
          message,
        );
        setIsRecovering(transient);
        if (!transient) {
          setError(message);
          toast.error("Ошибка AI Workflow", { description: message });
        } else {
          toast.warning("AI Workflow backend просыпается", {
            description:
              "Render free service может отвечать медленно после простоя. Мы продолжим проверки.",
            duration: 8000,
          });
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [accessToken, organizationId, preview, projectId],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (preview || isRecovering || !supabase || !organizationId) return;
    const refreshSoon = () => {
      setLastRealtimeAt(Date.now());
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void refresh(true), 280);
    };
    let channel = supabase.channel(`ai-workflow:${organizationId}`);
    for (const table of [
      "ai_tasks",
      "task_events",
      "approval_requests",
      "artifacts",
      "ai_agents",
      "workflow_runs",
      "task_dependencies",
      "agent_runs",
      "notifications",
    ] as const) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `organization_id=eq.${organizationId}` },
        refreshSoon,
      );
    }
    channel.subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (supabase) void supabase.removeChannel(channel);
      setRealtimeConnected(false);
    };
  }, [isRecovering, organizationId, preview, refresh]);

  const prependTask = useCallback((task: WorkflowTask, eventMessage?: string) => {
    setOverview((current) => ({
      ...current,
      tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)],
      events: eventMessage
        ? [
            {
              id: `optimistic:${task.id}`,
              organization_id: task.organization_id,
              task_id: task.id,
              project_id: task.project_id,
              agent_id: task.agent_id,
              event_type: "assigned",
              message: eventMessage,
              metadata: { optimistic: true },
              created_at: new Date().toISOString(),
            },
            ...current.events.filter((event) => event.id !== `optimistic:${task.id}`),
          ]
        : current.events,
    }));
  }, []);

  const updateLocalTask = useCallback((taskId: string, patch: Partial<WorkflowTask>) => {
    setOverview((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
      approval_requests:
        patch.status === "done" || patch.status === "revisions_requested"
          ? current.approval_requests.filter((request) => request.task_id !== taskId)
          : current.approval_requests,
    }));
  }, []);

  const removeApprovalRequest = useCallback((taskId: string) => {
    setOverview((current) => ({
      ...current,
      approval_requests: current.approval_requests.filter((request) => request.task_id !== taskId),
    }));
  }, []);

  return {
    overview,
    isLoading,
    isRefreshing,
    error,
    isRecovering,
    isRealtimeConnected,
    lastRealtimeAt,
    refresh,
    prependTask,
    updateLocalTask,
    removeApprovalRequest,
  };
}
