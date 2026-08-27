from __future__ import annotations

import io
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.services.receipt_ocr import receipt_ocr_service, ReceiptOCRResult
from backend.services.supabase_client import supabase_service
from backend.services.telegram_bot import telegram_bot, TelegramMessage

router = APIRouter(prefix="/api/telegram", tags=["telegram-receipts"])

logger = logging.getLogger(__name__)


# ---- Helper functions ----

def _get_user_organization(user_id: str) -> Optional[dict]:
    """Get organization_id for a user from profiles table."""
    try:
        result = supabase_service.client.table("profiles").select("organization_id").eq("user_id", user_id).single().execute()
        if result.data:
            return {"organization_id": result.data["organization_id"]}
    except Exception as e:
        logger.warning(f"Could not get organization for user {user_id}: {e}")
    return None


def _save_receipt_to_db(
    telegram_chat_id: str,
    photo_url: str,
    ocr_result: ReceiptOCRResult,
    user_id: str,
) -> dict:
    """Save OCR receipt result to database and create finance transaction."""
    organization = _get_user_organization(user_id)
    if not organization:
        raise ValueError(f"Could not determine organization for user {user_id}")

    # Insert receipt record
    receipt_data = {
        "user_id": user_id,
        "organization_id": organization["organization_id"],
        "telegram_chat_id": telegram_chat_id,
        "photo_url": photo_url,
        "raw_ocr_text": ocr_result.raw_ocr_text,
        "amount": ocr_result.amount,
        "currency": ocr_result.currency,
        "receipt_date": ocr_result.receipt_date,
        "category": ocr_result.category,
        "description": ocr_result.description,
        "merchant_name": ocr_result.merchant_name,
        "confidence": ocr_result.confidence,
        "status": "parsed",
    }

    result = supabase_service.client.table("receipts").insert(receipt_data).execute()

    if not result.data:
        raise Exception("Failed to insert receipt record")

    receipt = result.data[0]

    # Create finance transaction linked to receipt
    transaction_data = {
        "user_id": user_id,
        "organization_id": organization["organization_id"],
        "label": f"Receipt: {ocr_result.merchant_name or 'Purchase'}",
        "amount": ocr_result.amount,
        "type": "expense",
        "category": ocr_result.category,
        "occurred_on": ocr_result.receipt_date,
        "created_by": user_id,
    }

    tx_result = supabase_service.client.table("finance_transactions").insert(transaction_data).execute()

    if tx_result.data:
        transaction = tx_result.data[0]
        # Link receipt to transaction
        supabase_service.client.table("receipts").update({
            "finance_transaction_id": transaction["id"],
        }).eq("id", receipt["id"]).execute()

        receipt["finance_transaction_id"] = transaction["id"]

    return receipt


# ---- Telegram Webhook Endpoints ----

@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Telegram Bot Webhook endpoint.
    Receives updates from Telegram API when users send messages/photos.
    """
    try:
        update = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    update_id = update.get("update_id")
    if not update_id:
        raise HTTPException(status_code=400, detail="Missing update_id")

    # Check what type of update this is
    message = update.get("message")
    if not message:
        # Ignore other update types (callback queries, inline queries, etc.)
        return {"status": "ignored"}

    chat = message.get("chat", {})
    chat_id = str(chat.get("id"))
    message_text = message.get("text", "")

    # Handle text commands
    if message_text:
        if message_text.startswith("/"):
            await _handle_command(chat_id, message_text, message.from_user.id)
            return {"status": "command_handled"}

    # Handle photo messages (receipt OCR)
    if "photo" in message:
        photo = message["photo"]
        # Get the largest photo (last in the array)
        photo_file_id = photo[-1]["file_id"]

        # Process in background to avoid timeout
        background_tasks.add_task(
            _process_receipt_photo,
            chat_id=chat_id,
            photo_file_id=photo_file_id,
            user_id=str(message.from_user.id) if message.from_user else "",
        )

        # Send immediate acknowledgement
        await telegram_bot.send_message(TelegramMessage(
            chat_id=chat_id,
            text="📥 Received your receipt photo! Processing with OCR...",
        ))

        return {"status": "photo_queued"}

    return {"status": "no_handled_action"}


async def _handle_command(chat_id: str, command: str, user_id: str):
    """Handle Telegram bot commands."""
    command = command.strip().lower()

    if command == "/start":
        await telegram_bot.send_message(TelegramMessage(
            chat_id=chat_id,
            text=(
                "👋 <b>Welcome to Expense Tracker Bot!</b>\n\n"
                "Send me photos of receipts and I'll automatically extract:\n"
                "• Total amount\n"
                "• Date of purchase\n"
                "• Merchant name\n"
                "• Category (groceries, transport, dining, etc.)\n\n"
                "You can also use:\n"
                "/help - Show help\n"
                "/history - Show your expense history"
            ),
        ))

    elif command == "/help":
        await telegram_bot.send_message(TelegramMessage(
            chat_id=chat_id,
            text=(
                "📸 <b>How to use:</b>\n"
                "1. Send a photo of a receipt/quittance\n"
                "2. I'll extract the amount, date, and category using AI\n"
                "3. I'll save it to your expense tracker\n"
                "4. You can confirm or edit the extracted data\n\n"
                "Commands:\n"
                "/start - Welcome message\n"
                "/help - This help\n"
                "/history - Show your recent expenses"
            ),
        ))

    elif command == "/history":
        await _show_expense_history(chat_id, user_id)


async def _show_expense_history(chat_id: str, user_id: str):
    """Show user's expense history from receipts."""
    try:
        # Get user's organization
        org = _get_user_organization(user_id)
        if not org:
            await telegram_bot.send_message(TelegramMessage(
                chat_id=chat_id,
                text="❌ Could not determine your organization. Please contact admin.",
            ))
            return

        # Get receipts for this user/organization
        result = supabase_service.client.table("receipts") \
            .select("*") \
            .eq("organization_id", org["organization_id"]) \
            .order("created_at", desc=True) \
            .limit(10) \
            .execute()

        receipts = result.data or []

        if not receipts:
            await telegram_bot.send_message(TelegramMessage(
                chat_id=chat_id,
                text="📝 No receipts found in your history.",
            ))
            return

        text = "📊 <b>Recent Expenses</b>\n\n"
        for r in receipts:
            tx_id = r.get("finance_transaction_id")
            tx_info = ""
            if tx_id:
                tx_result = supabase_service.client.table("finance_transactions") \
                    .select("id, amount, occurred_on") \
                    .eq("id", tx_id) \
                    .single() \
                    .execute()
                if tx_result.data:
                    tx = tx_result.data
                    tx_info = f" • ₴{tx.get('amount', 0):.2f} • {tx.get('occurred_on', '')}"

            text += (
                f"🧾 <b>{r.get('merchant_name', '—')}</b>\n"
                f"   💰 {r.get('amount', 0):.2f} {r.get('currency', 'UAH')}\n"
                f"   📅 {r.get('receipt_date', '')}{tx_info}\n"
                f"   🏷 {r.get('category', 'other')}\n"
                f"   📸 {r.get('created_at', '')[:10]}\n\n"
            )

        await telegram_bot.send_message(TelegramMessage(chat_id=chat_id, text=text))

    except Exception as e:
        logger.error(f"Error showing expense history: {e}")
        await telegram_bot.send_message(TelegramMessage(
            chat_id=chat_id,
            text="❌ Error loading expense history.",
        ))


async def _process_receipt_photo(chat_id: str, photo_file_id: str, user_id: str):
    """Background task: process receipt photo - download, OCR, save to DB."""
    try:
        # Get file bytes from Telegram using the bot's method
        photo_bytes = await telegram_bot.download_file(photo_file_id)

        # Run OCR using OpenAI Vision
        ocr_result: ReceiptOCRResult = await receipt_ocr_service.extract_receipt_data(photo_bytes)

        # Determine the photo storage path
        # Upload photo to Supabase Storage
        photo_filename = f"receipt_{chat_id}_{photo_file_id}.jpg"
        upload_result = await supabase_service.upload_bytes(
            project_id=user_id,
            content=photo_bytes,
            filename=photo_filename,
            content_type="image/jpeg",
        )
        photo_url = upload_result["public_url"]

        # Save to database
        receipt = await _save_receipt_to_db(
            telegram_chat_id=chat_id,
            photo_url=photo_url,
            ocr_result=ocr_result,
            user_id=user_id,
        )

        # Format and send confirmation to user
        category_display = receipt["category"].replace("_", " ").title()
        confirmation_text = (
            f"✅ <b>Receipt processed successfully!</b>\n\n"
            f"💰 <b>Amount:</b> {receipt['amount']:.2f} {receipt['currency']}\n"
            f"📅 <b>Date:</b> {receipt['receipt_date']}\n"
            f"🏷 <b>Category:</b> {category_display}\n"
            f"🏪 <b>Merchant:</b> {receipt['merchant_name'] or '—'}\n"
            f"📝 <b>Description:</b> {receipt['description']}\n"
            f"🎯 <b>Confidence:</b> {receipt['confidence']:.0%}"
        )

        # Send the confirmation message
        await telegram_bot.send_message(TelegramMessage(
            chat_id=chat_id,
            text=confirmation_text,
        ))

    except Exception as e:
        logger.error(f"Error processing receipt photo: {e}", exc_info=True)
        await telegram_bot.send_message(TelegramMessage(
            chat_id=chat_id,
            text=f"❌ <b>Error processing receipt:</b> {str(e)[:200]}\n"
                 "Please try again with a clearer photo.",
        ))
