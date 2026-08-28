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
  retry: () => Promise<BackendStatus>;
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
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<BackendStatus>("checking");

  const checkHealth = useCallback(async (): Promise<BackendStatus> => {
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
        statusRef.current = "online";
        retryDelayRef.current = 15_000;
      } else if (response.status === 502 || response.status === 503) {
        setStatus("warming");
        statusRef.current = "warming";
        retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 60_000);
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      } else {
        setStatus("offline");
        statusRef.current = "offline";
        retryDelayRef.current = 30_000;
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      }
      setLastCheck(new Date());
      return statusRef.current;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("waking up") || message.includes("просып")) {
        setStatus("warming");
        statusRef.current = "warming";
        retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 60_000);
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      } else {
        setStatus("offline");
        statusRef.current = "offline";
        retryDelayRef.current = 30_000;
        setNextRetryAt(new Date(Date.now() + retryDelayRef.current));
      }
      setLatencyMs(Math.round(performance.now() - startedAt));
      setLastCheck(new Date());
      return statusRef.current;
    }
  }, []);

  const scheduleNextCheck = useCallback(
    (nextStatus: BackendStatus, visible: boolean) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);

      const delay =
        nextStatus === "online"
          ? visible
            ? 10 * 60_000
            : 30 * 60_000
          : nextStatus === "warming"
            ? 8_000
            : 30_000;

      setNextRetryAt(new Date(Date.now() + delay));
      timerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        void checkHealth();
      }, delay);
    },
    [checkHealth],
  );

  const toggleDemoMode = useCallback(() => {
    setIsDemoMode((prev) => {
      const next = !prev;
      localStorage.setItem("ai-workflow-demo", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void checkHealth().then((nextStatus) => {
      scheduleNextCheck(nextStatus, document.visibilityState === "visible");
    });

    const onVisibilityChange = () => {
      if (!mountedRef.current) return;
      void checkHealth().then((nextStatus) => {
        scheduleNextCheck(nextStatus, document.visibilityState === "visible");
      });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkHealth, scheduleNextCheck]);

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
