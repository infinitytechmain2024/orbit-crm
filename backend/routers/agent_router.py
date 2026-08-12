import os
from typing import Dict, List

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
    task_hint: str = ""


@router.post("/process")
def process_agent_task(
    payload: TaskRequest,
    auth: str = Depends(verify_internal_token),
):
    result = agent.run_task(payload.messages, payload.task_hint)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result
