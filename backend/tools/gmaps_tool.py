from __future__ import annotations

"""Google Maps Scraper Tool — wraps gmaps_scraper for lead generation."""

import csv
import io
import json
import logging
import time
import urllib.request
import urllib.parse
import urllib.error
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

SCRAPER_BASE_URL = "http://localhost:8080"
LEAD_FIELDS = ["title", "phone", "emails", "website", "category", "address", "review_rating", "review_count"]
UA = "orbit-crm-gmaps-tool/1.0"


@dataclass
class GMapsToolResult:
    success: bool
    leads: list[dict]
    count: int
    error: Optional[str] = None


class GMapsTool:
    """Tool for scraping Google Maps business listings for lead generation."""

    name: str = "google_maps_search"
    description: str = (
        "Searches Google Maps for local businesses. "
        "Use when the user wants to find businesses, shops, restaurants, "
        "services, or any local establishment in a specific city/location. "
        "Returns structured lead data: name, phone, email, website, address, rating."
    )
    parameters: dict = field(default_factory=lambda: {
        "type": "object",
        "properties": {
            "keywords": {
                "type": "string",
                "description": "Search keywords, e.g. 'barbershop', 'coffee shop', 'dentist'",
            },
            "location": {
                "type": "string",
                "description": "City/location to search in, e.g. 'Miami FL', 'Austin TX'",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of results (default 20)",
                "default": 20,
            },
        },
        "required": ["keywords", "location"],
    })

    def _geocode(self, place: str) -> Optional[tuple[str, str]]:
        """Geocode a place name to lat/lon using Nominatim."""
        q = urllib.parse.urlencode({"format": "json", "limit": 1, "q": place})
        url = f"https://nominatim.openstreetmap.org/search?{q}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                hits = json.loads(resp.read())
            time.sleep(1)  # Nominatim rate limit
            if hits:
                return str(hits[0]["lat"]), str(hits[0]["lon"])
        except Exception as e:
            logger.warning(f"Geocoding failed for '{place}': {e}")
        return None

    def _api_request(self, method: str, path: str, body: Optional[dict] = None) -> tuple[int, bytes]:
        """Make a request to the Google Maps Scraper API."""
        headers = {"Content-Type": "application/json", "User-Agent": UA}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(SCRAPER_BASE_URL + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()

    def _check_scraper_health(self) -> bool:
        """Check if the scraper Docker container is running."""
        try:
            self._api_request("GET", "/api/v1/jobs")
            return True
        except Exception:
            return False

    async def execute(self, keywords: str, location: str, limit: int = 20) -> GMapsToolResult:
        """Search Google Maps for businesses matching keywords in a location."""
        logger.info(f"GMapsTool: searching '{keywords}' in '{location}' (limit={limit})")

        # Check if scraper is available
        if not self._check_scraper_health():
            return GMapsToolResult(
                success=False,
                leads=[],
                count=0,
                error=(
                    "Google Maps Scraper is not running. "
                    "Start it with: cd gmaps_scraper && docker compose up -d"
                ),
            )

        # Geocode the location
        coords = self._geocode(location)
        if not coords:
            return GMapsToolResult(
                success=False,
                leads=[],
                count=0,
                error=f"Could not geocode location: {location}",
            )
        lat, lon = coords
        logger.info(f"GMapsTool: geocoded '{location}' -> {lat}, {lon}")

        # Create search job
        search_keywords = [keywords] if isinstance(keywords, str) else keywords
        body = {
            "name": "orbit-crm-search",
            "keywords": search_keywords,
            "lang": "en",
            "zoom": 15,
            "lat": str(lat),
            "lon": str(lon),
            "fast_mode": False,
            "radius": 10000,
            "depth": 5,
            "email": True,
            "max_time": 600,
        }

        try:
            _, raw = self._api_request("POST", "/api/v1/jobs", body)
            job_data = json.loads(raw)
            job_id = job_data.get("id")
            if not job_id:
                return GMapsToolResult(
                    success=False, leads=[], count=0,
                    error="No job ID returned from scraper",
                )
        except Exception as e:
            return GMapsToolResult(
                success=False, leads=[], count=0,
                error=f"Failed to create scraper job: {str(e)}",
            )

        # Poll for completion
        logger.info(f"GMapsTool: job created {job_id}, polling...")
        for i in range(120):  # Max 16 minutes
            try:
                _, raw = self._api_request("GET", f"/api/v1/jobs/{job_id}")
                status_data = json.loads(raw)
                status = status_data.get("Status")
                if status == "ok":
                    break
                if status == "failed":
                    return GMapsToolResult(
                        success=False, leads=[], count=0,
                        error="Scraper job failed — possibly rate-limited by Google",
                    )
                time.sleep(8)
            except Exception as e:
                logger.warning(f"Poll attempt {i} failed: {e}")
                time.sleep(8)
        else:
            return GMapsToolResult(
                success=False, leads=[], count=0,
                error="Scraper job timed out after 16 minutes",
            )

        # Download results
        try:
            _, raw = self._api_request("GET", f"/api/v1/jobs/{job_id}/download")
            rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))
        except Exception as e:
            return GMapsToolResult(
                success=False, leads=[], count=0,
                error=f"Failed to download results: {str(e)}",
            )

        # Extract lead fields only
        leads = []
        for row in rows[:limit]:
            lead = {k: row.get(k, "") for k in LEAD_FIELDS}
            # Clean up
            lead["title"] = lead.get("title", "").strip()
            lead["phone"] = lead.get("phone", "").strip()
            lead["website"] = lead.get("website", "").strip()
            lead["emails"] = lead.get("emails", "").strip()
            lead["address"] = lead.get("address", "").strip()
            if lead["title"]:
                leads.append(lead)

        logger.info(f"GMapsTool: found {len(leads)} leads")
        return GMapsToolResult(success=True, leads=leads, count=len(leads))


gmaps_tool = GMapsTool()
