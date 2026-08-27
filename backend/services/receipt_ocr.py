from __future__ import annotations

import io
import json
import logging
from typing import Any

import openai
from PIL import Image

from backend.config import settings
from backend.services.supabase_client import supabase_service

logger = logging.getLogger(__name__)


class ReceiptOCRResult:
    """Structured result from OCR processing of a receipt."""

    def __init__(
        self,
        amount: float,
        currency: str,
        receipt_date: str,
        category: str,
        description: str,
        merchant_name: str,
        raw_ocr_text: str,
        confidence: float,
    ):
        self.amount = amount
        self.currency = currency
        self.receipt_date = receipt_date
        self.category = category
        self.description = description
        self.merchant_name = merchant_name
        self.raw_ocr_text = raw_ocr_text
        self.confidence = confidence

    def to_dict(self) -> dict[str, Any]:
        return {
            "amount": self.amount,
            "currency": self.currency,
            "receipt_date": self.receipt_date,
            "category": self.category,
            "description": self.description,
            "merchant_name": self.merchant_name,
            "raw_ocr_text": self.raw_ocr_text,
            "confidence": self.confidence,
        }


class ReceiptOCRService:
    """Service for extracting receipt data using OpenAI Vision API."""

    def __init__(self):
        self.client = openai.OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL if settings.OPENAI_BASE_URL != "https://api.openai.com/v1" else None,
        )
        self.model = settings.OPENAI_MODEL or "gpt-4o-mini"

    async def extract_receipt_data(self, image_bytes: bytes) -> ReceiptOCRResult:
        """
        Extract receipt data from image bytes using OpenAI Vision API.

        Returns structured ReceiptOCRResult with:
        - amount: extracted total amount
        - currency: currency code
        - receipt_date: purchase date
        - category: expense category
        - description: merchant/items description
        - merchant_name: store/merchant name
        - raw_ocr_text: full OCR output
        - confidence: OpenAI confidence score
        """
        try:
            # Convert bytes to image for OpenAI
            image = Image.open(io.BytesIO(image_bytes))

            # Prepare the message for OpenAI Vision
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract the following information from this receipt/image. "
                                "Be precise and return only valid JSON. Do not include any reasoning or extra text.\n\n"
                                "Extract:\n"
                                "1. 'amount' - the total amount paid (as a number, no currency symbol)\n"
                                "2. 'currency' - the currency code (e.g., UAH, USD, EUR). If unclear, default to UAH.\n"
                                "3. 'receipt_date' - the date of purchase in YYYY-MM-DD format. If only day/month visible, use current year.\n"
                                "4. 'category' - one of: groceries, transport, dining, utilities, pharmacy, shopping, services, other. Choose the most appropriate.\n"
                                "5. 'description' - a brief description of the purchase (merchant name or items bought)\n"
                                "6. 'merchant_name' - the name of the store/merchant (or empty string if unclear)\n"
                                "7. 'confidence' - your confidence score in this extraction from 0.0 to 1.0\n\n"
                                "Return JSON with keys: amount (number), currency (string), receipt_date (string YYYY-MM-DD), "
                                "category (string), description (string), merchant_name (string), confidence (number 0-1)."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{self._image_to_base64(image)}",
                                "detail": "high",
                            },
                        },
                    ],
                }
            ]

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0,
                max_tokens=500,
            )

            response_text = response.choices[0].message.content

            # Parse JSON from response
            try:
                parsed = json.loads(response_text)
            except json.JSONDecodeError:
                # Try to extract JSON from the response
                start = response_text.find("{")
                end = response_text.rfind("}") + 1
                if start >= 0 and end > start:
                    parsed = json.loads(response_text[start:end])
                else:
                    raise ValueError(f"Could not parse JSON from OCR response: {response_text}")

            # Validate and normalize the result
            amount = float(parsed.get("amount", 0))
            currency = parsed.get("currency", "UAH").upper()
            if currency not in ["UAH", "USD", "EUR", "GBP", "PLN"]:
                currency = "UAH"
            receipt_date = parsed.get("receipt_date", "")
            category = parsed.get("category", "other").lower()
            valid_categories = [
                "groceries",
                "transport",
                "dining",
                "utilities",
                "pharmacy",
                "shopping",
                "services",
                "other",
            ]
            if category not in valid_categories:
                category = "other"
            description = parsed.get("description", "").strip()
            merchant_name = parsed.get("merchant_name", "").strip() or None
            confidence = float(parsed.get("confidence", 0.0))

            # Ensure confidence is between 0 and 1
            confidence = max(0.0, min(1.0, confidence))

            # Ensure amount is positive
            amount = max(0, amount)

            return ReceiptOCRResult(
                amount=amount,
                currency=currency,
                receipt_date=receipt_date,
                category=category,
                description=description or "Receipt purchase",
                merchant_name=merchant_name,
                raw_ocr_text=response_text,
                confidence=confidence,
            )

        except Exception as e:
            logger.error(f"OpenAI Vision OCR failed: {e}")
            raise

    @staticmethod
    def _image_to_base64(image: "Image.Image") -> str:
        """Convert PIL Image to base64 string."""
        import base64
        import io

        buffered = io.BytesIO()
        # Convert to RGB if necessary (JPEG/PNG compatibility)
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(buffered, format="JPEG", quality=85)
        img_bytes = buffered.getvalue()
        return base64.b64encode(img_bytes).decode("utf-8")


# Create singleton instance
receipt_ocr_service = ReceiptOCRService()