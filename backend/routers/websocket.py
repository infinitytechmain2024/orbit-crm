from __future__ import annotations

"""
WebSocket Activity Stream endpoint
Provides real-time task and workflow updates to the frontend
"""

import asyncio
import json
import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


class ActivityEvent(BaseModel):
    type: str  # "task_update", "agent_status", "approval_request", "deployment", "system"
    task_id: Optional[str] = None
    agent_id: Optional[str] = None
    department_id: Optional[str] = None
    message: str
    metadata: dict = {}
    timestamp: str = datetime.now().isoformat()


class ConnectionManager:
    """Manages WebSocket connections for activity stream"""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.connection_info: dict[WebSocket, dict] = {}

    async def connect(self, websocket: WebSocket, user_id: Optional[str] = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_info[websocket] = {
            "user_id": user_id,
            "connected_at": datetime.now().isoformat(),
        }
        logger.info(f"WebSocket connected: {user_id} (total: {len(self.active_connections)})")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            info = self.connection_info.pop(websocket, {})
            logger.info(f"WebSocket disconnected: {info.get('user_id')} (total: {len(self.active_connections)})")

    async def broadcast(self, event: ActivityEvent):
        """Broadcast event to all connected clients"""
        message = event.model_dump_json()
        disconnected = []

        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                disconnected.append(connection)

        # Clean up disconnected clients
        for conn in disconnected:
            self.disconnect(conn)

    async def send_to_user(self, user_id: str, event: ActivityEvent):
        """Send event to specific user"""
        message = event.model_dump_json()

        for connection in self.active_connections:
            info = self.connection_info.get(connection, {})
            if info.get("user_id") == user_id:
                try:
                    await connection.send_text(message)
                except Exception:
                    self.disconnect(connection)

    @property
    def connection_count(self) -> int:
        return len(self.active_connections)


# Global connection manager
activity_manager = ConnectionManager()


@router.websocket("/ws/activity")
async def websocket_activity(
    websocket: WebSocket,
    user_id: Optional[str] = Query(default=None),
    token: Optional[str] = Query(default=None),
):
    """
    WebSocket endpoint for real-time activity stream.

    Query params:
        user_id: Optional user ID for targeted messages
        token: Optional auth token (for future use)

    Events sent:
        - task_update: Task status changes
        - agent_status: Agent availability updates
        - approval_request: New approval requests
        - deployment: Deployment status updates
        - system: System-wide notifications
    """
    await activity_manager.connect(websocket, user_id)

    try:
        # Send connection confirmation
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to activity stream",
            "connection_count": activity_manager.connection_count,
            "timestamp": datetime.now().isoformat(),
        })

        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for messages from client (with timeout for ping/pong)
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)

                # Handle client messages (e.g., subscriptions, filters)
                try:
                    message = json.loads(data)
                    if message.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif message.get("type") == "subscribe":
                        # Future: handle topic subscriptions
                        await websocket.send_json({
                            "type": "subscribed",
                            "topics": message.get("topics", []),
                        })
                except json.JSONDecodeError:
                    pass

            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

    except WebSocketDisconnect:
        activity_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        activity_manager.disconnect(websocket)


# Helper functions for broadcasting events (called from other services)

async def broadcast_task_update(
    task_id: str,
    status: str,
    message: str,
    department_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    **metadata,
):
    """Broadcast task status update"""
    event = ActivityEvent(
        type="task_update",
        task_id=task_id,
        agent_id=agent_id,
        department_id=department_id,
        message=message,
        metadata={"status": status, **metadata},
    )
    await activity_manager.broadcast(event)


async def broadcast_agent_status(
    agent_id: str,
    status: str,
    message: str,
    department_id: Optional[str] = None,
    **metadata,
):
    """Broadcast agent status change"""
    event = ActivityEvent(
        type="agent_status",
        agent_id=agent_id,
        department_id=department_id,
        message=message,
        metadata={"status": status, **metadata},
    )
    await activity_manager.broadcast(event)


async def broadcast_approval_request(
    task_id: str,
    message: str,
    requested_by: Optional[str] = None,
    **metadata,
):
    """Broadcast new approval request"""
    event = ActivityEvent(
        type="approval_request",
        task_id=task_id,
        message=message,
        metadata={"requested_by": requested_by, **metadata},
    )
    await activity_manager.broadcast(event)


async def broadcast_deployment(
    task_id: str,
    status: str,
    message: str,
    **metadata,
):
    """Broadcast deployment status update"""
    event = ActivityEvent(
        type="deployment",
        task_id=task_id,
        message=message,
        metadata={"status": status, **metadata},
    )
    await activity_manager.broadcast(event)


async def broadcast_system(message: str, **metadata):
    """Broadcast system-wide notification"""
    event = ActivityEvent(
        type="system",
        message=message,
        metadata=metadata,
    )
    await activity_manager.broadcast(event)


def get_activity_manager() -> ConnectionManager:
    """Get the global activity manager instance"""
    return activity_manager