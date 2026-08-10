"""OpenManus Web Intelligence Tool — wraps OpenManus for deep web research."""

import json
import logging
import asyncio
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ManusToolResult:
    success: bool
    data: str
    error: Optional[str] = None


class ManusTool:
    """Tool for deep web intelligence using OpenManus browser agent."""

    name: str = "web_intelligence"
    description: str = (
        "Performs deep web research and website analysis. "
        "Use for finding company websites, analyzing their content, "
        "scraping contact information, or any task requiring browser automation."
    )
    parameters: dict = field(default_factory=lambda: {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Research query or URL to analyze",
            },
            "task_type": {
                "type": "string",
                "enum": ["search", "analyze", "scrape", "extract_contacts"],
                "description": "Type of web task to perform",
            },
        },
        "required": ["query", "task_type"],
    })

    def __init__(self):
        self._initialized = False

    def _build_task_prompt(self, query: str, task_type: str) -> str:
        """Build a task prompt for OpenManus."""
        prompts = {
            "search": (
                f"Search the web for information about: {query}. "
                "Find the top 3-5 relevant results with titles, URLs, and brief descriptions. "
                "Return results as a JSON array with fields: title, url, description."
            ),
            "analyze": (
                f"Analyze the website or business: {query}. "
                "Extract key information including: business name, services offered, "
                "contact info (phone, email, address), social media links, "
                "and an assessment of their web presence quality. "
                "Return as JSON."
            ),
            "scrape": (
                f"Scrape the following URL for business information: {query}. "
                "Extract all contact details, services, about section info, "
                "and any lead-relevant data. Return as structured JSON."
            ),
            "extract_contacts": (
                f"Visit this website and extract ALL contact information: {query}. "
                "Look for: phone numbers, email addresses, physical addresses, "
                "contact forms, social media profiles. "
                "Return as JSON with fields: phones, emails, address, socials."
            ),
        }
        return prompts.get(task_type, prompts["search"])

    async def execute(self, query: str, task_type: str = "search") -> ManusToolResult:
        """Execute web intelligence task using OpenManus."""
        try:
            prompt = self._build_task_prompt(query, task_type)
            logger.info(f"ManusTool: executing {task_type} task: {query[:80]}")

            # Try to use OpenManus flow if available
            result = await self._run_openmanus(prompt)
            return ManusToolResult(success=True, data=result)

        except Exception as e:
            logger.error(f"ManusTool failed: {e}")
            # Fallback to basic requests-based scraping
            try:
                result = await self._fallback_scrape(query, task_type)
                return ManusToolResult(success=True, data=result)
            except Exception as e2:
                return ManusToolResult(
                    success=False,
                    data="",
                    error=f"ManusTool failed: {str(e)}; Fallback also failed: {str(e2)}",
                )

    async def _run_openmanus(self, prompt: str) -> str:
        """Run OpenManus flow for complex browser tasks."""
        try:
            import sys
            sys.path.insert(0, "/Users/dmytrolishchyna/Desktop/ORBIT CRM/openmanus")
            from app.flow.flow import Flow

            flow = Flow()
            result = await flow.run(prompt)
            if isinstance(result, dict):
                return json.dumps(result, ensure_ascii=False, indent=2)
            return str(result)
        except Exception as e:
            logger.warning(f"OpenManus flow unavailable: {e}, using fallback")
            raise

    async def _fallback_scrape(self, query: str, task_type: str) -> str:
        """Fallback web scraping using requests + BeautifulSoup."""
        import requests
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        }

        if task_type in ("analyze", "scrape", "extract_contacts"):
            url = query if query.startswith("http") else f"https://{query}"
            try:
                resp = requests.get(url, headers=headers, timeout=15)
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "html.parser")

                # Remove script and style elements
                for tag in soup(["script", "style", "nav", "footer"]):
                    tag.decompose()

                title = soup.title.string.strip() if soup.title and soup.title.string else ""

                # Extract text content
                text = soup.get_text(separator="\n", strip=True)
                text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
                text = text[:3000]  # Limit to first 3000 chars

                # Extract links
                links = []
                for a in soup.find_all("a", href=True)[:20]:
                    href = a["href"]
                    if href.startswith("http") and "mailto:" not in href:
                        links.append(href)

                result = {
                    "url": url,
                    "title": title,
                    "content_preview": text,
                    "links": links[:10],
                }
                return json.dumps(result, ensure_ascii=False, indent=2)
            except Exception as e:
                return json.dumps({"error": f"Failed to scrape {url}: {str(e)}"})
        else:
            # For search, use DuckDuckGo HTML
            search_url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
            try:
                resp = requests.get(search_url, headers=headers, timeout=15)
                soup = BeautifulSoup(resp.text, "html.parser")
                results = []
                for item in soup.select(".result")[:5]:
                    title_el = item.select_one(".result__a")
                    snippet_el = item.select_one(".result__snippet")
                    if title_el:
                        results.append({
                            "title": title_el.get_text(strip=True),
                            "url": title_el.get("href", ""),
                            "description": snippet_el.get_text(strip=True) if snippet_el else "",
                        })
                return json.dumps(results, ensure_ascii=False, indent=2)
            except Exception as e:
                return json.dumps({"error": f"Search failed: {str(e)}"})


manus_tool = ManusTool()
