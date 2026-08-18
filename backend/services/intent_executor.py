from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from backend.services.ai_dispatcher import Intent, ai_dispatcher
from backend.services.supabase_client import supabase_service
from backend.services.telegram_bot import telegram_bot
from backend.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    success: bool
    action: str
    result: dict | None = None
    error: str | None = None


async def execute_intent(user_id: str, intent: Intent) -> ExecutionResult:
    """Execute classified intent by calling appropriate handlers."""
    
    match intent.type:
        case "CREATE_PROJECT":
            return await _execute_create_project(user_id, intent)
        case "ADD_TASK":
            return await _execute_add_task(user_id, intent)
        case "CALCULATE_ESTIMATE":
            return await _execute_calculate_estimate(user_id, intent)
        case "RUN_LEAD_SEARCH":
            return await _execute_run_lead_search(user_id, intent)
        case _:
            return ExecutionResult(
                success=False,
                action="UNKNOWN",
                error="Неизвестное намерение",
            )


async def _execute_create_project(user_id: str, intent: Intent) -> ExecutionResult:
    entities = intent.entities
    project_name = entities.get("projectName") or entities.get("projectDescription") or "Новый проект"
    description = entities.get("projectDescription", f"Создано через ИИ: {intent.raw_text}")
    
    try:
        result = supabase_service.client.table("projects").insert({
            "name": project_name,
            "description": description,
            "status": "active",
            "owner_id": user_id,
            "created_by": user_id,
        }).execute()
        
        if result.data:
            project = result.data[0]
            # Add owner as member
            supabase_service.client.table("project_members").insert({
                "project_id": project["id"],
                "user_id": user_id,
                "role": "owner",
            }).execute()
            
            # Notify Telegram
            await telegram_bot.notify_project_created(project)
            
            return ExecutionResult(
                success=True,
                action="CREATE_PROJECT",
                result={"project_id": project["id"], "project_name": project["name"]},
            )
        raise Exception("No data returned")
    except Exception as e:
        logger.error(f"Create project failed: {e}")
        return ExecutionResult(success=False, action="CREATE_PROJECT", error=str(e))


async def _execute_add_task(user_id: str, intent: Intent) -> ExecutionResult:
    entities = intent.entities
    task_title = entities.get("taskTitle")
    project_name = entities.get("projectName")
    
    if not task_title:
        return ExecutionResult(
            success=False,
            action="ADD_TASK",
            error="Не указано название задачи",
        )
    
    project_id = None
    project_found_name = "Без проекта"
    
    if project_name:
        # Fuzzy search project by name
        result = supabase_service.client.table("projects").select("id, name").ilike("name", f"%{project_name}%").limit(1).execute()
        if result.data:
            project_id = result.data[0]["id"]
            project_found_name = result.data[0]["name"]
    
    try:
        task_result = supabase_service.client.table("tasks").insert({
            "title": task_title,
            "description": f"Создано через голосовую команду: {intent.raw_text}",
            "status": "backlog",
            "priority": "high",
            "project_id": project_id,
            "created_by": user_id,
            "assigned_user_id": user_id,
        }).execute()
        
        if task_result.data:
            task = task_result.data[0]
            await telegram_bot.notify_task_added(task, project_found_name)
            
            return ExecutionResult(
                success=True,
                action="ADD_TASK",
                result={
                    "task_id": task["id"],
                    "task_title": task["title"],
                    "project_id": project_id,
                    "project_name": project_found_name,
                },
            )
        raise Exception("No data returned")
    except Exception as e:
        logger.error(f"Add task failed: {e}")
        return ExecutionResult(success=False, action="ADD_TASK", error=str(e))


async def _execute_calculate_estimate(user_id: str, intent: Intent) -> ExecutionResult:
    entities = intent.entities
    project_name = entities.get("projectName") or entities.get("projectDescription") or "Проект"
    hours = entities.get("hours", 0)
    
    if hours <= 0:
        return ExecutionResult(
            success=False,
            action="CALCULATE_ESTIMATE",
            error="Не указано количество часов для расчета сметы",
        )
    
    rate_per_hour = 10
    buffer_percent = 15
    currency = "EUR"
    
    base = hours * rate_per_hour
    buffer = base * buffer_percent / 100
    total = base + buffer
    
    estimate_data = {
        "hours": hours,
        "rate_per_hour": rate_per_hour,
        "buffer_percent": buffer_percent,
        "currency": currency,
        "base_cost": base,
        "buffer_cost": buffer,
        "total_cost": total,
    }
    
    # Create project with estimate
    try:
        result = supabase_service.client.table("projects").insert({
            "name": project_name,
            "description": f"Смета: {hours}ч × ${rate_per_hour} + {buffer_percent}% = ${total:.2f} {currency}. Голосовая команда: {intent.raw_text}",
            "status": "active",
            "budget_planned": total,
            "currency": currency,
            "owner_id": user_id,
            "created_by": user_id,
        }).execute()
        
        if result.data:
            project = result.data[0]
            supabase_service.client.table("project_members").insert({
                "project_id": project["id"],
                "user_id": user_id,
                "role": "owner",
            }).execute()
            
            await telegram_bot.notify_estimate(project, estimate_data)
            
            return ExecutionResult(
                success=True,
                action="CALCULATE_ESTIMATE",
                result={
                    "project_id": project["id"],
                    "project_name": project["name"],
                    "estimate": estimate_data,
                },
            )
        raise Exception("No data returned")
    except Exception as e:
        logger.error(f"Calculate estimate failed: {e}")
        return ExecutionResult(success=False, action="CALCULATE_ESTIMATE", error=str(e))


async def _execute_run_lead_search(user_id: str, intent: Intent) -> ExecutionResult:
    entities = intent.entities
    city = entities.get("city")
    niche = entities.get("niche")
    max_results = entities.get("maxResults", 20)
    
    if not city or not niche:
        return ExecutionResult(
            success=False,
            action="RUN_LEAD_SEARCH",
            error="Не указан город или ниша для поиска",
        )
    
    # Create lead search job record
    try:
        result = supabase_service.client.table("lead_search_jobs").insert({
            "user_id": user_id,
            "city": city,
            "niche": niche,
            "max_results": max_results,
            "status": "queued",
            "raw_request": intent.raw_text,
        }).execute()
        
        if result.data:
            job = result.data[0]
            # Trigger async search (will be handled by lead-generator service)
            # For now, return job info
            return ExecutionResult(
                success=True,
                action="RUN_LEAD_SEARCH",
                result={
                    "job_id": job["id"],
                    "city": city,
                    "niche": niche,
                    "max_results": max_results,
                    "status": "queued",
                },
            )
        raise Exception("No data returned")
    except Exception as e:
        logger.error(f"Run lead search failed: {e}")
        return ExecutionResult(success=False, action="RUN_LEAD_SEARCH", error=str(e))