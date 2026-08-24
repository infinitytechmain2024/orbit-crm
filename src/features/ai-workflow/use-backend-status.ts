/**
 * Hook for checking backend health status
 * Replaces static demo mode banner with live connection check
 */

import { useState, useEffect, useCallback } from "react";

export type BackendStatus = "checking" | "online" | "offline";

export interface UseBackendStatusReturn {
  status: BackendStatus;
  lastCheck: Date | null;
  retry: () => Promise<void>;
  isDemoMode: boolean;
  toggleDemoMode: () => void;
}

export function useBackendStatus(): UseBackendStatusReturn {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ai-workflow-demo") === "true";
    }
    return false;
  });

  const checkHealth = useCallback(async () => {
    setStatus("checking");
    try {
      const response = await fetch("/api/health", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      setStatus(response.ok ? "online" : "offline");
      setLastCheck(new Date());
    } catch {
      setStatus("offline");
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
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return { status, lastCheck, retry: checkHealth, isDemoMode, toggleDemoMode };
}
