import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase/client";
import { fetchWorkflowOverview } from "./api";
import { createDemoOverview } from "./demo-data";
import type { WorkflowOverview, WorkflowTask } from "./types";

const EMPTY_OVERVIEW: WorkflowOverview = {
  departments: [],
  agents: [],
  tasks: [],
  events: [],
  artifacts: [],
  approval_requests: [],
  projects: [],
  model_configs: [],
  workflow_runs: [],
  task_dependencies: [],
  agent_runs: [],
  notifications: [],
  provider: { nvidia_configured: false, voice_configured: false, autorun: false },
};

function canUseDemoFallback(message: string) {
  const normalized = message.toLocaleLowerCase();
  return [
    "backend url is not configured",
    "server authentication is not configured",
    "backend is unavailable",
    "failed to fetch",
    "pgrst205",
    "could not find the table",
    "ai workflow api: 500",
    "ai workflow api: 502",
    "ai workflow api: 503",
  ].some((fragment) => normalized.includes(fragment));
}

export function useAiWorkflow(
  accessToken: string | undefined,
  organizationId: string | undefined,
  projectId: string,
  preview = false,
) {
  const [overview, setOverview] = useState<WorkflowOverview>(EMPTY_OVERVIEW);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setDemoFallback] = useState(false);
  const [isRealtimeConnected, setRealtimeConnected] = useState(false);
  const [lastRealtimeAt, setLastRealtimeAt] = useState(0);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (quiet = false) => {
      if (preview) {
        setOverview(createDemoOverview(projectId));
        setIsLoading(false);
        setIsRefreshing(false);
        setError(null);
        setDemoFallback(false);
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
        setDemoFallback(false);
      } catch (unknownError) {
        const message =
          unknownError instanceof Error ? unknownError.message : "Не удалось загрузить AI Workflow";
        if (canUseDemoFallback(message)) {
          const demo = createDemoOverview(projectId);
          setOverview({
            ...demo,
            provider: {
              nvidia_configured: false,
              configured: [],
              voice_configured: false,
              autorun: false,
              worker_enabled: false,
            },
          });
          setError(null);
          setDemoFallback(true);
          toast.warning("AI Workflow backend недоступен", {
            description: "Показан демо-режим. Настройте AI_WORKFLOW_BACKEND_URL для работы с реальными данными.",
            duration: 8000,
          });
        } else {
          setError(message);
          setDemoFallback(false);
          toast.error("Ошибка AI Workflow", { description: message });
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [accessToken, organizationId, preview, projectId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (preview || isDemoFallback || !supabase || !organizationId) return;
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
  }, [isDemoFallback, organizationId, preview, refresh]);

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

  return {
    overview,
    isLoading,
    isRefreshing,
    error,
    isDemoFallback,
    isRealtimeConnected,
    lastRealtimeAt,
    refresh,
    prependTask,
    updateLocalTask,
  };
}
