"""OpenManus Browser Scraper — Playwright-based web scraping for lead generation.

Handles:
  - Google search execution
  - Website crawling for contact extraction
  - Anti-bot mitigation (random delays, user-agent rotation)
"""

import asyncio
import logging
import random
import re
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Try importing playwright; graceful fallback if not installed
try:
    from playwright.async_api import async_playwright, Browser, Page, Playwright
    HAS_PLAYRIGHT = True
except ImportError:
    HAS_PLAYRIGHT = False
    logger.warning("Playwright not installed. Install with: pip install playwright && playwright install chromium")


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]


@dataclass
class ScrapedPage:
    """Result of scraping a single page."""
    url: str
    title: str = ""
    html: str = ""
    text_content: str = ""
    success: bool = False
    error: str | None = None


class BrowserScraper:
    """Playwright-based browser scraper for lead generation."""

    def __init__(self, headless: bool = True, slow_mo: int = 100):
        self.headless = headless
        self.slow_mo = slow_mo
        self._playwright: Optional["Playwright"] = None
        self._browser: Optional["Browser"] = None

    async def start(self):
        """Launch the browser."""
        if not HAS_PLAYRIGHT:
            raise RuntimeError(
                "Playwright not installed. Run: pip install playwright && playwright install chromium"
            )
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self.headless,
            slow_mo=self.slow_mo,
        )
        logger.info("Browser scraper started")

    async def stop(self):
        """Close the browser."""
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("Browser scraper stopped")

    async def _get_page(self) -> "Page":
        if not self._browser:
            await self.start()
        context = await self._browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        # Add stealth scripts to avoid detection
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        """)
        return await context.new_page()

    async def _random_delay(self, min_s: float = 1.0, max_s: float = 3.0):
        """Random delay to mimic human behavior."""
        await asyncio.sleep(random.uniform(min_s, max_s))

    # ========================================
    # Google Search
    # ========================================

    async def search_google(self, query: str, max_results: int = 10) -> list[ScrapedPage]:
        """Execute a Google search and return result pages."""
        page = await self._get_page()
        results: list[ScrapedPage] = []

        try:
            search_url = f"https://www.google.com/search?q={query}&num={max_results}"
            await page.goto(search_url, wait_until="domcontentloaded")
            await self._random_delay(2, 4)

            # Handle consent dialogs (GDPR)
            try:
                consent_btn = page.locator('button:has-text("Accept"), button:has-text("I agree")')
                if await consent_btn.count() > 0:
                    await consent_btn.first.click()
                    await self._random_delay(1, 2)
            except Exception:
                pass

            # Extract search result links
            links = await page.locator("div.g a[href^='http']").all()
            seen_urls: set[str] = set()

            for link in links[:max_results * 2]:  # Get extra to filter
                try:
                    href = await link.get_attribute("href")
                    if not href or href in seen_urls:
                        continue
                    if any(x in href for x in ["google.com", "youtube.com", "googleapis.com"]):
                        continue
                    seen_urls.add(href)
                    results.append(ScrapedPage(url=href, success=True))
                    if len(results) >= max_results:
                        break
                except Exception:
                    continue

        except Exception as e:
            logger.error(f"Google search failed for '{query}': {e}")
        finally:
            await page.context.close()

        return results

    # ========================================
    # Page Crawling
    # ========================================

    async def crawl_page(self, url: str) -> ScrapedPage:
        """Crawl a single page and extract HTML content."""
        page = await self._get_page()
        result = ScrapedPage(url=url)

        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            if response and response.status >= 400:
                result.error = f"HTTP {response.status}"
                return result

            await self._random_delay(1, 2)

            result.title = await page.title()
            result.html = await page.content()
            result.text_content = await page.inner_text("body")
            result.success = True

        except Exception as e:
            result.error = str(e)
            logger.warning(f"Failed to crawl {url}: {e}")
        finally:
            await page.context.close()

        return result

    # ========================================
    # Contact Extraction
    # ========================================

    async def extract_contacts_from_page(self, url: str) -> dict:
        """Crawl a page and extract contact information."""
        scraped = await self.crawl_page(url)
        if not scraped.success:
            return {"url": url, "error": scraped.error}

        html = scraped.html
        text = scraped.text_content

        contacts: dict = {"url": url, "title": scraped.title}

        # Emails
        emails = list(set(re.findall(
            r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
            html + text
        )))
        emails = [e for e in emails if not any(x in e.lower() for x in ['@sentry', '@example', 'noreply'])]
        if emails:
            contacts["email"] = emails[0]
            contacts["all_emails"] = emails[:5]

        # Phones
        phones = re.findall(
            r'(?:\+?\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}',
            text
        )
        phones = [p.strip() for p in phones if len(re.sub(r'\D', '', p)) >= 7]
        if phones:
            contacts["phone"] = phones[0]
            contacts["all_phones"] = phones[:5]

        # Social links
        social = {}
        social_patterns = {
            'linkedin': r'(https?://(?:www\.)?linkedin\.com/(?:company|in)/[^\s"\'<>]+)',
            'telegram': r'(https?://(?:t\.me|telegram\.me)/[^\s"\'<>]+)',
            'whatsapp': r'(https?://(?:wa\.me|api\.whatsapp\.com/send)[^\s"\'<>]+)',
            'instagram': r'(https?://(?:www\.)?instagram\.com/[^\s"\'<>]+)',
            'facebook': r'(https?://(?:www\.)?facebook\.com/[^\s"\'<>]+)',
        }
        for platform, pattern in social_patterns.items():
            match = re.search(pattern, html)
            if match:
                social[platform] = match.group(1)
        if social:
            contacts["social_links"] = social

        return contacts

    # ========================================
    # Batch Search
    # ========================================

    async def search_and_extract(
        self, queries: list[str], max_results_per_query: int = 5
    ) -> list[dict]:
        """Execute multiple searches and extract contacts from results."""
        all_contacts: list[dict] = []
        seen_urls: set[str] = set()

        for query in queries:
            logger.info(f"Searching: {query}")
            results = await self.search_google(query, max_results_per_query)

            for result_page in results:
                if result_page.url in seen_urls:
                    continue
                seen_urls.add(result_page.url)

                contacts = await self.extract_contacts_from_page(result_page.url)
                if contacts.get("email") or contacts.get("phone"):
                    all_contacts.append(contacts)

                await self._random_delay(2, 5)  # Be polite

        return all_contacts
