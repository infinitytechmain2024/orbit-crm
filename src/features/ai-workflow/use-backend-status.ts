/**
 * Hook for checking backend health status
 * Replaces static demo mode banner with live connection check
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { authenticatedFetch } from "@/lib/api-client";

export type BackendStatus = "checking" | "online" | "offline" | "warming";

export interface UseBackendStatusReturn {
  status: BackendStatus;
  lastCheck: Date | null;
  latencyMs: number | null;
  nextRetryAt: Date | null;
  retry: () => Promise<void>;
  isDemoMode: boolean;
  toggleDemoMode: () => void;
}

export function useBackendStatus(): UseBackendStatusReturn {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [nextRetryAt, setNextRetryAt] = useState<Date | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ai-workflow-demo") === "true";
    }
    return false;
  });
  const retryDelayRef = useRef(15_000);

  const checkHealth = useCallback(async () => {
    setStatus((current) =>
      current === "online" ? "checking" : current === "warming" ? "warming" : "checking",
    );
    const startedAt = performance.now();
    try {
      const response = await authenticatedFetch("/api/backend/api/health", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      const endedAt = performance.now();
      setLatencyMs(Math.round(endedAt - startedAt));
      setNextRetryAt(null);
      if (response.ok) {
        setStatus("online");
        retryDelayRef.current = 15_000;
      } else if (response.status === 502 || response.status === 503) {
        setStatus("warming");
        retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 60_000);
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      } else {
        setStatus("offline");
        retryDelayRef.current = 30_000;
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      }
      setLastCheck(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("waking up") || message.includes("просып")) {
        setStatus("warming");
        retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 60_000);
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      } else {
        setStatus("offline");
        retryDelayRef.current = 30_000;
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      }
      setLatencyMs(Math.round(performance.now() - startedAt));
      setLastCheck(new Date());
    }
  }, []);

  const toggleDemoMode = useCallback(() => {
    setIsDemoMode((prev) => {
      const next = !prev;
      localStorage.setItem("ai-workflow-demo", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 15_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return {
    status,
    lastCheck,
    latencyMs,
    nextRetryAt,
    retry: checkHealth,
    isDemoMode,
    toggleDemoMode,
  };
}
