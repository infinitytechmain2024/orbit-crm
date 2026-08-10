"""OpenManus agent wrapper for lead generation."""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime
from typing import Optional

import httpx

from markdown_report import generate_report
from models import Lead, SearchCriteria, SearchJob, SearchStatus


class LeadGenerationAgent:
    """Agent that uses Llama 3.2 via Ollama to find and analyze leads."""

    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        self.jobs: dict[str, SearchJob] = {}
        self._http_client = httpx.AsyncClient(timeout=120.0)

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

    async def search_leads(self, criteria: SearchCriteria) -> str:
        """Execute a lead search job.

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
        """Execute the actual search process."""
        job = self.jobs[job_id]

        try:
            system_prompt = """You are an expert lead generation researcher. 
Search for potential business clients matching the given criteria.
For each lead, extract structured data including name, company, industry, contacts, and ICP fit analysis.
Always respond with valid JSON array of lead objects."""

            search_prompt = f"""Find potential clients for a CRM/wellness business with these criteria:

Industry: {criteria.industry}
Location: {criteria.location}
Company Size: {criteria.company_size}
Keywords: {', '.join(criteria.keywords) if criteria.keywords else 'none specified'}

Search for businesses that could benefit from CRM software, client management tools, 
or wellness industry solutions.

For each lead found, return a JSON object with these fields:
- name: Contact person or business name
- company: Company name
- industry: Their industry
- location: Their location
- email: Contact email (if found)
- phone: Phone number (if found)
- website: Website URL
- linkedin: LinkedIn URL (if found)
- description: Brief description of their business
- icp_score: Score from 1-10 on how well they match the ideal customer profile
- analysis: Why they match or don't match the ICP
- outreach_approach: Recommended way to make first contact

Return a JSON array of leads. Find up to {criteria.max_results} leads.
Focus on quality matches over quantity."""

            # Call LLM for lead search
            raw_response = await self._call_llm(search_prompt, system_prompt)

            # Parse leads from response
            leads = self._parse_leads_from_response(raw_response, criteria)

            # Generate Markdown report
            filepath, summary = generate_report(criteria, leads)

            job.status = SearchStatus.COMPLETED
            job.leads_found = len(leads)
            job.report_path = filepath
            job.completed_at = datetime.now()

        except Exception as e:
            job.status = SearchStatus.FAILED
            job.error = str(e)
            job.completed_at = datetime.now()

    def _parse_leads_from_response(
        self, response: str, criteria: SearchCriteria
    ) -> list[Lead]:
        """Parse LLM response into structured Lead objects."""
        # Try to extract JSON from response
        json_match = re.search(r"\[.*\]", response, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group())
                leads = []
                for item in data:
                    lead = Lead(
                        name=item.get("name", "Unknown"),
                        company=item.get("company", ""),
                        industry=item.get("industry", criteria.industry),
                        location=item.get("location", criteria.location),
                        email=item.get("email"),
                        phone=item.get("phone"),
                        website=item.get("website"),
                        linkedin=item.get("linkedin"),
                        description=item.get("description", ""),
                        icp_score=min(max(int(item.get("icp_score", 5)), 1), 10),
                        analysis=item.get("analysis", ""),
                        outreach_approach=item.get("outreach_approach", ""),
                    )
                    leads.append(lead)
                return leads[:criteria.max_results]
            except (json.JSONDecodeError, KeyError):
                pass

        # Fallback: create a single lead from the text analysis
        return [
            Lead(
                name="Analysis Result",
                company="See report for details",
                industry=criteria.industry,
                location=criteria.location,
                description=response[:500],
                icp_score=5,
                analysis="Raw LLM response could not be parsed into structured data. "
                "See full report for details.",
                outreach_approach="Review the detailed report and adjust search criteria.",
            )
        ]

    def get_job_status(self, job_id: str) -> Optional[SearchJob]:
        """Get status of a search job."""
        return self.jobs.get(job_id)

    def list_jobs(self) -> list[SearchJob]:
        """List all search jobs."""
        return list(self.jobs.values())

    async def close(self):
        """Clean up resources."""
        await self._http_client.aclose()
