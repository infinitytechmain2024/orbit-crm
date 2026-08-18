from __future__ import annotations

import os
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from backend.agent_core import MasterAgent


router = APIRouter(prefix="/api/agent", tags=["Agent"])
agent = MasterAgent()


INTERNAL_TOKEN = os.getenv("INTERNAL_API_TOKEN")


def verify_internal_token(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = authorization.split(" ")[1]
    if token != INTERNAL_TOKEN:
        raise HTTPException(status_code=403, detail="Access denied")


class TaskRequest(BaseModel):
    messages: List[Dict[str, str]]
    task_hint: Optional[str] = ""
    model_name: Optional[str] = None  # Новое поле: можно передать имя модели с фронта


@router.post("/process")
async def process_agent_task(payload: TaskRequest, token: str = Depends(verify_internal_token)):
    result = agent.run_task(
        messages=payload.messages,
        task_type_hint=payload.task_hint,
        model_name=payload.model_name
    )
    return result
