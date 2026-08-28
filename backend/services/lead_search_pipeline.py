from __future__ import annotations

"""Unified lead search pipeline.

Discovery is performed through Google Maps browser scraping. Results are then
enriched with OpenManus when possible, and finally normalized into the lead
shape used by the CRM UI.
"""

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class LeadSearchResult:
    id: str
    business_name: str
    address: str
    phone: str
    email: str
    website: str
    category: str
    rating: float
    reviews: int
    source: str
    google_maps_url: str
    enrichment_source: str = ""


def _normalize_lead(raw: dict[str, Any], index: int) -> LeadSearchResult:
    business_name = str(raw.get("business_name") or raw.get("title") or "Unknown")
    website = str(raw.get("website") or raw.get("website_url") or "")
    phone = str(raw.get("phone") or raw.get("contact_phone") or "")
    email = str(raw.get("email") or raw.get("emails") or "")
    if email and "," in email:
        email = email.split(",")[0].strip()

    return LeadSearchResult(
        id=str(raw.get("id") or f"lead-{index}"),
        business_name=business_name,
        address=str(raw.get("address") or ""),
        phone=phone,
        email=email,
        website=website,
        category=str(raw.get("category") or ""),
        rating=float(raw.get("rating") or 0),
        reviews=int(raw.get("reviews") or 0),
        source=str(raw.get("source") or "google_maps"),
        google_maps_url=str(raw.get("google_maps_url") or ""),
        enrichment_source=str(raw.get("enrichment_source") or ""),
    )


class LeadSearchPipeline:
    async def search(self, niche: str, city: str, country: str, limit: int) -> list[dict[str, Any]]:
        from backend.tools.gmaps_browser_scraper import search_google_maps_browser

        logger.info(
            "Unified lead search started niche=%s city=%s country=%s limit=%s",
            niche,
            city,
            country,
            limit,
        )

        discovery = await search_google_maps_browser(
            niche=niche,
            city=city,
            limit=limit,
            headless=True,
        )

        normalized = [_normalize_lead(dict(lead), idx) for idx, lead in enumerate(discovery)]
        enriched = await self._enrich_with_openmanus(normalized, niche=niche, city=city, country=country)
        return [lead.__dict__ for lead in enriched]

    async def _enrich_with_openmanus(
        self,
        leads: list[LeadSearchResult],
        niche: str,
        city: str,
        country: str,
    ) -> list[LeadSearchResult]:
        if not leads:
            return leads

        try:
            from backend.tools.manus_tool import manus_tool
        except Exception as e:
            logger.warning("OpenManus unavailable, skipping enrichment: %s", e)
            return leads

        enriched: list[LeadSearchResult] = []
        for index, lead in enumerate(leads):
            if lead.email and lead.website:
                enriched.append(lead)
                continue

            query_target = lead.website or lead.business_name
            query = (
                f"{query_target} {city} {country} contact information"
                if query_target
                else f"{niche} {city} {country}"
            )

            try:
                result = await manus_tool.execute(query=query, task_type="extract_contacts")
                if result.success and result.data:
                    lead = self._merge_openmanus_data(lead, result.data)
                    lead.enrichment_source = "openmanus"
            except Exception as e:
                logger.debug("OpenManus enrichment failed for %s: %s", lead.business_name, e)

            enriched.append(lead)

        return enriched

    def _merge_openmanus_data(self, lead: LeadSearchResult, raw_data: str) -> LeadSearchResult:
        import json
        import re

        try:
            data = json.loads(raw_data)
        except Exception:
            data = {}

        if isinstance(data, dict):
            lead.email = lead.email or str(data.get("email") or "")
            lead.phone = lead.phone or str(data.get("phone") or "")
            lead.website = lead.website or str(data.get("url") or data.get("website") or "")
            lead.address = lead.address or str(data.get("address") or "")
        elif isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                lead.email = lead.email or str(first.get("email") or "")
                lead.phone = lead.phone or str(first.get("phone") or "")
                lead.website = lead.website or str(first.get("url") or first.get("website") or "")

        if not lead.email:
            email_match = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", raw_data)
            if email_match:
                lead.email = email_match.group(1)

        if not lead.phone:
            phone_match = re.search(r"(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}", raw_data)
            if phone_match:
                lead.phone = phone_match.group(0)

        return lead


lead_search_pipeline = LeadSearchPipeline()
