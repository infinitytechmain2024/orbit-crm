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
from backend.services.ai_workflow_store import ai_workflow_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


class ActivityEvent(BaseModel):
    type: str  # "task_update", "agent_status", "approval_request", "deployment", "system"
    organization_id: str
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

    async def connect(self, websocket: WebSocket, user_id: str, organization_id: str):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_info[websocket] = {
            "user_id": user_id,
            "organization_id": organization_id,
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
            info = self.connection_info.get(connection, {})
            if info.get("organization_id") != event.organization_id:
                continue
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
    organization_id: str = Query(min_length=36, max_length=36),
    token: str = Query(min_length=1),
):
    """
    WebSocket endpoint for real-time activity stream.

    Query params:
        organization_id: Organization scope for the stream
        token: Supabase access token

    Events sent:
        - task_update: Task status changes
        - agent_status: Agent availability updates
        - approval_request: New approval requests
        - deployment: Deployment status updates
        - system: System-wide notifications
    """
    try:
        user = await ai_workflow_store.verify_user(token)
        await ai_workflow_store.ensure_membership(organization_id, str(user["id"]))
    except Exception:
        await websocket.close(code=1008, reason="Authentication failed")
        return

    await activity_manager.connect(websocket, str(user["id"]), organization_id)

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
    organization_id: str,
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
        organization_id=organization_id,
        task_id=task_id,
        agent_id=agent_id,
        department_id=department_id,
        message=message,
        metadata={"status": status, **metadata},
    )
    await activity_manager.broadcast(event)


async def broadcast_agent_status(
    organization_id: str,
    agent_id: str,
    status: str,
    message: str,
    department_id: Optional[str] = None,
    **metadata,
):
    """Broadcast agent status change"""
    event = ActivityEvent(
        type="agent_status",
        organization_id=organization_id,
        agent_id=agent_id,
        department_id=department_id,
        message=message,
        metadata={"status": status, **metadata},
    )
    await activity_manager.broadcast(event)


async def broadcast_approval_request(
    organization_id: str,
    task_id: str,
    message: str,
    requested_by: Optional[str] = None,
    **metadata,
):
    """Broadcast new approval request"""
    event = ActivityEvent(
        type="approval_request",
        organization_id=organization_id,
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
