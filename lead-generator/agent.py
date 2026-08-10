"""OpenManus agent wrapper for lead generation.

Integrates:
  - Liam Orchestrator (query generation, validation, scoring)
  - Playwright Browser Scraper (web crawling, contact extraction)
  - Supabase (lead storage)
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime
from typing import Optional

import httpx

from browser_scraper import BrowserScraper
from liam_orchestrator import LiamOrchestrator, ValidatedContact
from markdown_report import generate_report
from models import Lead, SearchCriteria, SearchJob, SearchStatus


class LeadGenerationAgent:
    """Agent that uses Liam + OpenManus to find and analyze leads."""

    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        self.jobs: dict[str, SearchJob] = {}
        self._http_client = httpx.AsyncClient(timeout=120.0)
        self.scraper = BrowserScraper(
            headless=os.getenv("OPENMANUS_HEADLESS", "true").lower() == "true",
            slow_mo=int(os.getenv("OPENMANUS_SLOW_MO", "100")),
        )
        self.orchestrator = LiamOrchestrator(
            ollama_url=self.ollama_url,
            ollama_model=os.getenv("OLLAMA_MODEL", "llama3.2"),
        )

    async def check_ollama_status(self) -> bool:
        """Check if Ollama is running and Llama 3.2 is available."""
        try:
            response = await self._http_client.get(
                f"{self.ollama_url.replace('/v1', '')}/api/tags"
            )
            if response.status_code == 200:
                models = response.json().get("models", [])
                return any("llama3.2" in m.get("name", "") for m in models)
            return False
        except Exception:
            return False

    async def search_leads(self, criteria: SearchCriteria) -> str:
        """Execute a lead search job using Liam + OpenManus.

        Returns:
            Job ID for tracking progress.
        """
        job_id = str(uuid.uuid4())[:8]
        job = SearchJob(
            job_id=job_id,
            status=SearchStatus.RUNNING,
            criteria=criteria,
            started_at=datetime.now(),
        )
        self.jobs[job_id] = job

        # Run search in background
        asyncio.create_task(self._execute_search(job_id, criteria))

        return job_id

    async def _execute_search(self, job_id: str, criteria: SearchCriteria):
        """Execute the full Liam + OpenManus search pipeline."""
        job = self.jobs[job_id]

        try:
            # Step 1: Liam generates search queries
            queries = await self.orchestrator.generate_search_queries(
                city=criteria.location,
                niche=criteria.industry,
                max_queries=5,
            )
            query_strings = [q.query for q in queries]
            logger.info(f"Generated {len(query_strings)} search queries")

            # Step 2: OpenManus executes searches and extracts contacts
            raw_contacts = await self.scraper.search_and_extract(
                queries=query_strings,
                max_results_per_query=criteria.max_results // len(query_strings) + 1,
            )
            logger.info(f"Extracted {len(raw_contacts)} raw contacts")

            # Step 3: Liam validates and structures contacts
            validated_contacts: list[ValidatedContact] = []
            for raw in raw_contacts:
                contact = ValidatedContact(
                    email=raw.get("email"),
                    phone=raw.get("phone"),
                    website=raw.get("url"),
                    social_links=raw.get("social_links", {}),
                    company_name=raw.get("title", "Unknown"),
                    source_url=raw.get("url", ""),
                )
                validated_contacts.append(contact)

            # Step 4: Deduplicate
            unique_contacts = self.orchestrator.deduplicate_contacts(validated_contacts)
            logger.info(f"After dedup: {len(unique_contacts)} unique contacts")

            # Step 5: Convert to Lead model for report
            leads = []
            for contact in unique_contacts:
                score = await self.orchestrator.score_lead(
                    contact, criteria.industry, criteria.location
                )
                lead = Lead(
                    name=contact.company_name or "Unknown",
                    company=contact.company_name or "",
                    industry=criteria.industry,
                    location=criteria.location,
                    email=contact.email,
                    phone=contact.phone,
                    website=contact.website,
                    description=f"Found via {contact.source_url}",
                    icp_score=score,
                    source_url=contact.source_url,
                )
                leads.append(lead)

            # Step 6: Generate Markdown report
            filepath, summary = generate_report(criteria, leads)

            job.status = SearchStatus.COMPLETED
            job.leads_found = len(leads)
            job.report_path = filepath
            job.completed_at = datetime.now()

            # Step 7: Save to Supabase (best effort)
            try:
                organization_id = os.getenv("DEFAULT_ORGANIZATION_ID", "")
                if organization_id:
                    await self.orchestrator.save_leads_to_db(
                        contacts=unique_contacts,
                        organization_id=organization_id,
                        source_query=f"{criteria.industry} in {criteria.location}",
                        niche=criteria.industry,
                        city=criteria.location,
                    )
            except Exception as e:
                logger.warning(f"Failed to save leads to Supabase: {e}")

        except Exception as e:
            job.status = SearchStatus.FAILED
            job.error = str(e)
            job.completed_at = datetime.now()
            logger.error(f"Search job {job_id} failed: {e}")

    async def _call_llm(self, prompt: str, system_prompt: str = "") -> str:
        """Call Llama 3.2 via Ollama API."""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            response = await self._http_client.post(
                f"{self.ollama_url}/chat/completions",
                json={
                    "model": "llama3.2",
                    "messages": messages,
                    "max_tokens": 4096,
                    "temperature": 0.3,
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise RuntimeError(f"Failed to call Ollama: {e}")

    def get_job_status(self, job_id: str) -> Optional[SearchJob]:
        """Get status of a search job."""
        return self.jobs.get(job_id)

    def list_jobs(self) -> list[SearchJob]:
        """List all search jobs."""
        return list(self.jobs.values())

    async def close(self):
        """Clean up resources."""
        await self._http_client.aclose()
        await self.scraper.stop()
        await self.orchestrator.close()
