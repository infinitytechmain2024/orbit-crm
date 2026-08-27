import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fetchWorkflowOverview } from "@/features/ai-workflow/api";
import { useWorkflowProgress } from "@/features/ai-workflow/use-workflow-progress";
import type { WorkflowOverview, WorkflowTask } from "@/features/ai-workflow/types";

function canUseDemoFallback(message: string) {
  const normalized = message.toLocaleLowerCase();
  return [
    "backend url is not configured",
    "server authentication is not configured",
    "backend is unavailable",
    "failed to fetch",
    "pgrst205",
    "could not find the table",
    "ai workflow api: 404",
    "ai workflow api: 500",
    "ai workflow api: 502",
    "ai workflow api: 503",
  ].some((fragment) => normalized.includes(fragment));
}

export interface AiWorkflowSummary {
  progress: number;
  total: number;
  completed: number;
  inProgress: number;
  queued: number;
  blocked: number;
  approvalRequired: number;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  isDemoFallback: boolean;
  isRealtimeConnected: boolean;
  refresh: () => Promise<void>;
}

export function useAiWorkflowSummary(
  accessToken: string | undefined,
  organizationId: string | undefined,
): AiWorkflowSummary {
  const [overview, setOverview] = useState<WorkflowOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setDemoFallback] = useState(false);
  const [isRealtimeConnected, setRealtimeConnected] = useState(false);
  const timerRef = useRef<number | null>(null);
  const toastShownRef = useRef(false);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!accessToken || !organizationId) return;
      if (quiet) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const data = await fetchWorkflowOverview(accessToken, organizationId);
        setOverview(data);
        setError(null);
        setDemoFallback(false);
        toastShownRef.current = false;
      } catch (unknownError) {
        const message =
          unknownError instanceof Error ? unknownError.message : "Не удалось загрузить AI Workflow";
        if (canUseDemoFallback(message)) {
          if (!toastShownRef.current) {
            toastShownRef.current = true;
            console.warn("AI Workflow backend недоступен, используем демо-режим");
          }
          setDemoFallback(true);
        } else {
          setError(message);
          setDemoFallback(false);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [accessToken, organizationId],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (isDemoFallback || !supabase || !organizationId) return;
    const refreshSoon = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void refresh(true), 280);
    };
    let channel = supabase.channel(`ai-workflow-summary:${organizationId}`);
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
  }, [isDemoFallback, organizationId, refresh]);

  const tasks = overview?.tasks ?? [];
  const progress = useWorkflowProgress(tasks);

  return {
    ...progress,
    isLoading,
    isRefreshing,
    error,
    isDemoFallback,
    isRealtimeConnected,
    refresh: () => refresh(false),
  };
}
