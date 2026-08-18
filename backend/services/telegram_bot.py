from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from backend.config import settings
from backend.services.supabase_client import supabase_service

logger = logging.getLogger(__name__)


@dataclass
class TelegramMessage:
    chat_id: str
    text: str
    parse_mode: str = "HTML"
    reply_markup: dict | None = None


class TelegramBot:
    def __init__(self):
        self.token = settings.TELEGRAM_BOT_TOKEN
        self.default_chat_id = settings.TELEGRAM_CHAT_ID
        self.webhook_url = settings.TELEGRAM_WEBHOOK_URL
        self._client: httpx.AsyncClient | None = None
        self._bot_info: dict | None = None

    @property
    def base_url(self) -> str:
        return f"https://api.telegram.org/bot{self.token}"

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _make_request(self, method: str, data: dict) -> dict:
        client = await self._get_client()
        response = await client.post(f"{self.base_url}/{method}", json=data)
        response.raise_for_status()
        result = response.json()
        if not result.get("ok"):
            raise Exception(f"Telegram API error: {result.get('description')}")
        return result["result"]

    async def get_me(self) -> dict:
        if self._bot_info is None:
            self._bot_info = await self._make_request("getMe", {})
        return self._bot_info

    async def set_webhook(self, url: str | None = None) -> bool:
        webhook = url or self.webhook_url
        if not webhook:
            logger.warning("No webhook URL configured")
            return False
        result = await self._make_request("setWebhook", {"url": webhook})
        logger.info(f"Webhook set: {result}")
        return True

    async def delete_webhook(self) -> bool:
        result = await self._make_request("deleteWebhook", {})
        return result

    async def send_message(self, message: TelegramMessage) -> dict:
        data = {
            "chat_id": message.chat_id,
            "text": message.text,
            "parse_mode": message.parse_mode,
        }
        if message.reply_markup:
            data["reply_markup"] = message.reply_markup
        return await self._make_request("sendMessage", data)

    async def send_document(self, chat_id: str, document_bytes: bytes, filename: str, caption: str = "") -> dict:
        client = await self._get_client()
        files = {"document": (filename, document_bytes)}
        data = {"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"}
        response = await client.post(f"{self.base_url}/sendDocument", files=files, data=data)
        response.raise_for_status()
        result = response.json()
        if not result.get("ok"):
            raise Exception(f"Telegram API error: {result.get('description')}")
        return result["result"]

    async def send_voice(self, chat_id: str, voice_bytes: bytes, filename: str = "voice.ogg") -> dict:
        client = await self._get_client()
        files = {"voice": (filename, voice_bytes, "audio/ogg")}
        data = {"chat_id": chat_id}
        response = await client.post(f"{self.base_url}/sendVoice", files=files, data=data)
        response.raise_for_status()
        result = response.json()
        if not result.get("ok"):
            raise Exception(f"Telegram API error: {result.get('description')}")
        return result["result"]

    def _format_project_created(self, project: dict) -> str:
        return (
            f"🚀 <b>Новый проект создан</b>\n\n"
            f"📋 <b>Название:</b> {project.get('name', '—')}\n"
            f"📝 <b>Описание:</b> {project.get('description', '—')}\n"
            f"💰 <b>Бюджет:</b> {project.get('budget_planned', 'не задан')}\n"
            f"📅 <b>Дедлайн:</b> {project.get('due_date', 'не задан')}\n"
            f"👤 <b>Владелец:</b> {project.get('owner_id', '—')}"
        )

    def _format_task_added(self, task: dict, project_name: str) -> str:
        return (
            f"✅ <b>Задача добавлена</b>\n\n"
            f"📋 <b>Проект:</b> {project_name}\n"
            f"📝 <b>Задача:</b> {task.get('title', '—')}\n"
            f"🔥 <b>Приоритет:</b> {task.get('priority', '—')}\n"
            f"📌 <b>Статус:</b> {task.get('status', 'backlog')}\n"
            f"👤 <b>Исполнитель:</b> {task.get('assigned_user_id', '—')}"
        )

    def _format_estimate(self, project: dict, estimate: dict) -> str:
        hours = estimate.get("hours", 0)
        rate = estimate.get("rate_per_hour", 10)
        buffer_pct = estimate.get("buffer_percent", 15)
        base = hours * rate
        buffer = base * buffer_pct / 100
        total = base + buffer
        currency = estimate.get("currency", "EUR")
        
        return (
            f"💰 <b>Смета рассчитана</b>\n\n"
            f"📋 <b>Проект:</b> {project.get('name', '—')}\n"
            f"⏱ <b>Часов:</b> {hours}\n"
            f"💵 <b>Ставка:</b> ${rate}/{currency}/час\n"
            f"📊 <b>Базовая стоимость:</b> ${base:,.2f} {currency}\n"
            f"🛡 <b>Буфер ({buffer_pct}%):</b> ${buffer:,.2f} {currency}\n"
            f"💎 <b>Итого:</b> <b>${total:,.2f} {currency}</b>"
        )

    def _format_leads_found(self, job: dict, leads_count: int) -> str:
        return (
            f"🔍 <b>Поиск лидов завершен</b>\n\n"
            f"🏙 <b>Город:</b> {job.get('city', '—')}\n"
            f"🎯 <b>Ниша:</b> {job.get('niche', '—')}\n"
            f"📊 <b>Найдено лидов:</b> {leads_count}\n"
            f"📄 <b>Отчет:</b> Готов к просмотру"
        )

    async def notify_project_created(self, project: dict, chat_id: str | None = None) -> dict:
        text = self._format_project_created(project)
        return await self.send_message(TelegramMessage(
            chat_id=chat_id or self.default_chat_id,
            text=text,
        ))

    async def notify_task_added(self, task: dict, project_name: str, chat_id: str | None = None) -> dict:
        text = self._format_task_added(task, project_name)
        return await self.send_message(TelegramMessage(
            chat_id=chat_id or self.default_chat_id,
            text=text,
        ))

    async def notify_estimate(self, project: dict, estimate: dict, chat_id: str | None = None) -> dict:
        text = self._format_estimate(project, estimate)
        return await self.send_message(TelegramMessage(
            chat_id=chat_id or self.default_chat_id,
            text=text,
        ))

    async def notify_leads_found(self, job: dict, leads_count: int, chat_id: str | None = None) -> dict:
        text = self._format_leads_found(job, leads_count)
        return await self.send_message(TelegramMessage(
            chat_id=chat_id or self.default_chat_id,
            text=text,
        ))

    async def send_report_file(
        self,
        project_id: str,
        report_filename: str,
        chat_id: str | None = None,
    ) -> dict:
        """Download report from Supabase and send to Telegram."""
        files = await supabase_service.list_project_files(project_id)
        report_file = next((f for f in files if f["name"] == report_filename), None)
        
        if not report_file:
            raise Exception(f"Report {report_filename} not found in project {project_id}")
        
        content = await supabase_service.download_file(report_file["path"])
        return await self.send_document(
            chat_id=chat_id or self.default_chat_id,
            document_bytes=content,
            filename=report_filename,
            caption=f"📄 <b>Отчет по проекту</b>\n{report_filename}",
        )

    async def process_voice_message(self, file_id: str, chat_id: str) -> dict:
        """Process voice message from Telegram: download -> STT -> AI Dispatcher -> Execute -> Reply."""
        from backend.services.stt import stt_service
        from backend.services.ai_dispatcher import ai_dispatcher, Intent
        from backend.services.intent_executor import execute_intent
        
        # Get file info
        file_info = await self._make_request("getFile", {"file_id": file_id})
        file_path = file_info["file_path"]
        file_url = f"https://api.telegram.org/file/bot{self.token}/{file_path}"
        
        # Download voice file
        client = await self._get_client()
        voice_response = await client.get(file_url)
        voice_response.raise_for_status()
        voice_bytes = voice_response.content
        
        # Transcribe
        transcript = await stt_service.transcribe_bytes(voice_bytes, "voice.ogg")
        
        if not transcript.strip():
            return await self.send_message(TelegramMessage(
                chat_id=chat_id,
                text="🎤 Не удалось расшифровать голосовое сообщение. Попробуйте еще раз.",
            ))
        
        # Classify intent
        intent = await ai_dispatcher.classify_intent(transcript)
        suggestions = await ai_dispatcher.generate_suggestions(intent)
        
        # Execute intent
        result = await execute_intent(chat_id, intent)
        
        # Format response
        if result.success:
            response_text = f"🎤 <b>Расшифровано:</b> {transcript}\n\n✅ <b>Выполнено:</b> {result.action}"
            if result.result:
                response_text += f"\n📋 <b>Детали:</b> {result.result}"
        else:
            response_text = f"🎤 <b>Расшифровано:</b> {transcript}\n\n❌ <b>Ошибка:</b> {result.error}"
        
        if suggestions:
            response_text += "\n\n💡 <b>Предложения:</b>\n" + "\n".join(f"• {s}" for s in suggestions)
        
        return await self.send_message(TelegramMessage(
            chat_id=chat_id,
            text=response_text,
        ))


telegram_bot = TelegramBot()