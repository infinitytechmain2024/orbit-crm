import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import { fetchWorkflowOverview } from "./api";
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
  provider: { nvidia_configured: false, voice_configured: false, autorun: false },
};

export function useAiWorkflow(
  accessToken: string | undefined,
  organizationId: string | undefined,
  projectId: string,
) {
  const [overview, setOverview] = useState<WorkflowOverview>(EMPTY_OVERVIEW);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRealtimeConnected, setRealtimeConnected] = useState(false);
  const [lastRealtimeAt, setLastRealtimeAt] = useState(0);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (quiet = false) => {
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
      } catch (unknownError) {
        setError(unknownError instanceof Error ? unknownError.message : "Не удалось загрузить AI Workflow");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [accessToken, organizationId, projectId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !organizationId) return;
    const refreshSoon = () => {
      setLastRealtimeAt(Date.now());
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void refresh(true), 280);
    };
    let channel = supabase.channel(`ai-workflow:${organizationId}`);
    for (const table of ["ai_tasks", "task_events", "approval_requests", "artifacts", "ai_agents"] as const) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `organization_id=eq.${organizationId}` },
        refreshSoon,
      );
    }
    channel.subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
      setRealtimeConnected(false);
    };
  }, [organizationId, refresh]);

  const prependTask = useCallback((task: WorkflowTask) => {
    setOverview((current) => ({
      ...current,
      tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)],
    }));
  }, []);

  return {
    overview,
    isLoading,
    isRefreshing,
    error,
    isRealtimeConnected,
    lastRealtimeAt,
    refresh,
    prependTask,
  };
}
