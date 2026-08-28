/**
 * Hook for checking backend health status
 * Replaces static demo mode banner with live connection check
 */

import { useEffect, useState, useCallback } from "react";
import { authenticatedFetch } from "@/lib/api-client";

export type BackendStatus = "checking" | "online" | "offline" | "warming";

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
    setStatus((current) =>
      current === "online" ? "checking" : current === "warming" ? "warming" : "checking",
    );
    try {
      const response = await authenticatedFetch("/api/backend/api/health", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        setStatus("online");
      } else if (response.status === 502 || response.status === 503) {
        setStatus("warming");
      } else {
        setStatus("offline");
      }
      setLastCheck(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("waking up") || message.includes("просып")) {
        setStatus("warming");
      } else {
        setStatus("offline");
      }
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
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return { status, lastCheck, retry: checkHealth, isDemoMode, toggleDemoMode };
}
