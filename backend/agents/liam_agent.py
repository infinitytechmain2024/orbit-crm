"""Liam Agent — PraisonAI orchestrator for Orbit CRM lead generation."""

import json
import logging
import sys
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Add project root to path for imports
sys.path.insert(0, "/Users/dmytrolishchyna/Desktop/ORBIT CRM")

from backend.config import settings


@dataclass
class LiamResponse:
    success: bool
    reply: str
    leads: list[dict] = field(default_factory=list)
    action_taken: str = ""
    error: Optional[str] = None


class LiamAgent:
    """
    Liam — AI orchestrator agent using PraisonAI with Ollama/Llama 3.2.
    
    Connects ManusTool and GMapsTool for lead generation.
    Routes requests:
    - Local businesses (barbershops, cafes, etc.) → gmaps_tool
    - General web research / deep analysis → manus_tool
    """

    name = "Liam"
    role = "Lead Generation Orchestrator"

    def __init__(self):
        self._agent = None
        self._tools = {"gmaps": None, "manus": None}
        self._load_tools()

    def _load_tools(self):
        """Load available tools."""
        try:
            from backend.tools.gmaps_tool import gmaps_tool
            self._tools["gmaps"] = gmaps_tool
            logger.info("Loaded GMapsTool")
        except Exception as e:
            logger.warning(f"GMapsTool not available: {e}")

        try:
            from backend.tools.manus_tool import manus_tool
            self._tools["manus"] = manus_tool
            logger.info("Loaded ManusTool")
        except Exception as e:
            logger.warning(f"ManusTool not available: {e}")

    def _get_praisonai_agent(self):
        """Create PraisonAI agent with tools."""
        try:
            from praisonaiagents import Agent, Task, PraisonAIAgents

            # Build tool list
            tools = []
            if self._tools["gmaps"]:
                tools.append(self._tools["gmaps"])
            if self._tools["manus"]:
                tools.append(self._tools["manus"])

            agent = Agent(
                name="Liam",
                role="Lead Generation AI Orchestrator",
                goal=(
                    "Help users find business leads, generate sales pitches, "
                    "and manage CRM data. Use Google Maps search for local businesses, "
                    "and web intelligence for deep research."
                ),
                instructions=(
                    "You are Liam, an AI assistant for Orbit CRM. "
                    "When the user asks about local businesses (barbershops, cafes, "
                    "restaurants, auto services, dentists, etc.), use the google_maps_search tool. "
                    "When the user needs deep web research, website analysis, or scraping, "
                    "use the web_intelligence tool. "
                    "Always respond in the same language as the user. "
                    "When you find leads, summarize them in a clean format."
                ),
                llm=f"ollama/{settings.OLLAMA_MODEL}",
                tools=tools if tools else None,
                allow_delegation=False,
            )
            return agent
        except Exception as e:
            logger.warning(f"PraisonAI agent creation failed: {e}")
            return None

    async def process(self, text: str, user_id: str = "default") -> LiamResponse:
        """Process a user message and route to appropriate tool."""
        logger.info(f"Liam processing: {text[:100]}")

        text_lower = text.lower()

        # Determine which tool to use based on keywords
        gmaps_keywords = [
            "барбершоп", "барбер", "кафе", "ресторан", "магазин",
            "автосервис", "стоматолог", "врач", "салон", "фитнес",
            "барbershop", "barber", "cafe", "café", "restaurant",
            "shop", "store", "auto", "dentist", "doctor", "salon",
            "gym", "fitness", "plumber", "electrician", "contractor",
            "salon", "spa", "nail", "hair", "beauty",
            "магазин", "магазин", "аптека", "банк",
        ]

        # Check if it's a local business search
        is_local_search = any(kw in text_lower for kw in gmaps_keywords)

        # Also check for location patterns
        has_location = any(
            word in text_lower
            for word in ["в ", "in ", "near ", "около ", "город ", "city "]
        )

        if is_local_search and self._tools["gmaps"]:
            return await self._search_google_maps(text)
        elif self._tools["manus"]:
            return await self._deep_web_search(text)
        else:
            return await self._llm_only_response(text)

    async def _search_google_maps(self, text: str) -> LiamResponse:
        """Use GMaps tool to find local businesses."""
        try:
            result = self._tools["gmaps"].execute(
                keywords=text,
                location="Miami FL",  # Default, will be parsed from text
                limit=20,
            )

            if result.success:
                # Save leads to Supabase
                saved_count = await self._save_leads_to_supabase(result.leads)

                # Generate sales pitch for first lead
                pitch = ""
                if result.leads:
                    first = result.leads[0]
                    pitch = await self._generate_sales_pitch(first)

                reply = (
                    f"Found {result.count} businesses. "
                    f"{saved_count} leads saved to CRM. "
                    + (f"\n\nSample pitch for {result.leads[0].get('title', 'N/A')}:\n{pitch}" if pitch else "")
                )

                return LiamResponse(
                    success=True,
                    reply=reply,
                    leads=result.leads,
                    action_taken="google_maps_search",
                )
            else:
                return LiamResponse(
                    success=False,
                    reply=f"Search failed: {result.error}",
                    error=result.error,
                )
        except Exception as e:
            logger.error(f"GMaps search failed: {e}")
            return LiamResponse(
                success=False,
                reply=f"Error: {str(e)}",
                error=str(e),
            )

    async def _deep_web_search(self, text: str) -> LiamResponse:
        """Use Manus tool for deep web research."""
        try:
            result = await self._tools["manus"].execute(
                query=text,
                task_type="search",
            )

            if result.success:
                return LiamResponse(
                    success=True,
                    reply=result.data,
                    action_taken="web_intelligence",
                )
            else:
                return LiamResponse(
                    success=False,
                    reply=f"Research failed: {result.error}",
                    error=result.error,
                )
        except Exception as e:
            logger.error(f"Manus search failed: {e}")
            return LiamResponse(
                success=False,
                reply=f"Error: {str(e)}",
                error=str(e),
            )

    async def _llm_only_response(self, text: str) -> LiamResponse:
        """Use LLM directly when no tools are available."""
        try:
            import httpx

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.OLLAMA_BASE_URL}/chat/completions",
                    json={
                        "model": settings.OLLAMA_MODEL,
                        "messages": [
                            {
                                "role": "system",
                                "content": (
                                    "You are Liam, an AI CRM assistant. "
                                    "You help with lead generation, sales pitches, "
                                    "and business management. Be helpful and concise."
                                ),
                            },
                            {"role": "user", "content": text},
                        ],
                        "temperature": 0.3,
                        "max_tokens": 1024,
                    },
                )
                response.raise_for_status()
                data = response.json()
                reply = data["choices"][0]["message"]["content"]
                return LiamResponse(success=True, reply=reply, action_taken="llm_chat")
        except Exception as e:
            return LiamResponse(
                success=False,
                reply=f"LLM error: {str(e)}",
                error=str(e),
            )

    async def _save_leads_to_supabase(self, leads: list[dict]) -> int:
        """Save leads to Supabase clients table."""
        try:
            from backend.services.supabase_client import supabase_service

            saved = 0
            for lead in leads:
                try:
                    supabase_service.client.table("clients").insert({
                        "name": lead.get("title", ""),
                        "phone": lead.get("phone", ""),
                        "email": lead.get("emails", "").split(",")[0] if lead.get("emails") else "",
                        "website": lead.get("website", ""),
                        "address": lead.get("address", ""),
                        "category": lead.get("category", ""),
                        "rating": float(lead.get("review_rating", 0) or 0),
                        "review_count": int(lead.get("review_count", 0) or 0),
                        "source": "google_maps",
                        "status": "new",
                    }).execute()
                    saved += 1
                except Exception as e:
                    logger.warning(f"Failed to save lead '{lead.get('title')}': {e}")
            return saved
        except Exception as e:
            logger.error(f"Failed to save leads: {e}")
            return 0

    async def _generate_sales_pitch(self, lead: dict) -> str:
        """Generate a sales pitch for a lead using LLM."""
        try:
            import httpx

            business_name = lead.get("title", "Business")
            category = lead.get("category", "business")
            website = lead.get("website", "No website")
            city = lead.get("address", "Unknown location")

            prompt = (
                f"Generate a brief 2-sentence sales pitch for a web development agency "
                f"reaching out to '{business_name}' ({category}) in {city}. "
                f"Website: {website}. "
                f"Focus on how a modern website can grow their business."
            )

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{settings.OLLAMA_BASE_URL}/chat/completions",
                    json={
                        "model": settings.OLLAMA_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": 200,
                    },
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
        except Exception:
            return ""


# Singleton
liam_agent = LiamAgent()
