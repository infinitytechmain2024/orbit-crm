/**
 * Hook for real-time activity stream via WebSocket
 * Connects to /ws/activity endpoint for live task and workflow updates
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface ActivityEvent {
  type: string;  // "task_update", "agent_status", "approval_request", "deployment", "system"
  task_id?: string;
  agent_id?: string;
  department_id?: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface UseActivityStreamReturn {
  events: ActivityEvent[];
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
  connectionCount: number;
}

export function useActivityStream(
  userId?: string,
  apiBaseUrl?: string
): UseActivityStreamReturn {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionCount, setConnectionCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;

  const getWsUrl = useCallback(() => {
    const base = apiBaseUrl || window.location.origin;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = new URL(base).host;
    const params = new URLSearchParams();
    if (userId) params.set("user_id", userId);
    return `${protocol}//${host}/ws/activity${params.toString() ? `?${params.toString()}` : ""}`;
  }, [userId, apiBaseUrl]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = getWsUrl();

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
        console.log("[ActivityStream] Connected");
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;

        // Auto-reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`[ActivityStream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle special message types
          if (data.type === "connected") {
            setConnectionCount(data.connection_count || 0);
            return;
          }
          if (data.type === "ping") {
            // Respond to server ping
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
          if (data.type === "pong") {
            return; // Ignore pong responses
          }

          // Regular activity event
          const event: ActivityEvent = {
            type: data.type || "unknown",
            task_id: data.task_id,
            agent_id: data.agent_id,
            department_id: data.department_id,
            message: data.message || "",
            metadata: data.metadata || {},
            timestamp: data.timestamp || new Date().toISOString(),
          };

          setEvents((prev) => [event, ...prev].slice(0, 100));  // Keep last 100 events
        } catch {
          // Ignore invalid messages
        }
      };
    } catch {
      setError("Failed to connect to WebSocket");
    }
  }, [getWsUrl]);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);

    return () => {
      clearInterval(heartbeat);
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return { events, isConnected, error, reconnect, connectionCount };
}