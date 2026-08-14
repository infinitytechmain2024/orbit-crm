/**
 * Hook for real-time activity stream via WebSocket
 * Replaces static event list with live updates
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface ActivityEvent {
  id: string;
  type: string;
  agent: string;
  project: string;
  task_id: string;
  message: string;
  status: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface UseActivityStreamReturn {
  events: ActivityEvent[];
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

export function useActivityStream(
  organizationId: string | undefined
): UseActivityStreamReturn {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!organizationId) return;

    const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/activity?org=${organizationId}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Auto-reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setEvents((prev) => [data, ...prev].slice(0, 100));
        } catch {
          // Ignore invalid messages
        }
      };
    } catch {
      setError("Failed to connect to WebSocket");
    }
  }, [organizationId]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return { events, isConnected, error, reconnect };
}