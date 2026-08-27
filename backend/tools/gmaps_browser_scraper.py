"""Google Maps Browser Scraper — Playwright-based scraping for lead generation.

Opens a real browser, navigates to Google Maps, searches for businesses,
scrolls through results, and extracts structured data. No API key required.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from playwright.async_api import async_playwright, Browser, Page, Playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    logger.warning(
        "Playwright not installed. Install with: "
        "pip install playwright && playwright install chromium"
    )

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]


@dataclass
class GMapsLead:
    business_name: str = ""
    address: str = ""
    phone: str = ""
    website: str = ""
    category: str = ""
    rating: float = 0.0
    reviews: int = 0
    google_maps_url: str = ""
    hours: str = ""


class GMapsBrowserScraper:
    """Scrapes Google Maps search results using a real browser."""

    def __init__(self, headless: bool = True, slow_mo: int = 50):
        self.headless = headless
        self.slow_mo = slow_mo
        self._playwright: Optional["Playwright"] = None
        self._browser: Optional["Browser"] = None

    async def start(self):
        if not HAS_PLAYWRIGHT:
            raise RuntimeError(
                "Playwright not installed. Run: pip install playwright && playwright install chromium"
            )
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self.headless,
            slow_mo=self.slow_mo,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
            ],
        )
        logger.info("GMaps browser scraper started")

    async def stop(self):
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("GMaps browser scraper stopped")

    async def _new_page(self) -> "Page":
        if not self._browser:
            await self.start()
        context = await self._browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
            geolocation={"latitude": 40.7128, "longitude": -74.0060},
            permissions=["geolocation"],
        )
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
        """)
        return await context.new_page()

    async def _random_delay(self, min_s: float = 1.0, max_s: float = 3.0):
        await asyncio.sleep(random.uniform(min_s, max_s))

    async def search(
        self,
        niche: str,
        city: str,
        country: str = "",
        limit: int = 20,
    ) -> list[GMapsLead]:
        """Search Google Maps for businesses and return structured leads."""
        query = f"{niche} in {city}" if not country else f"{niche} in {city}, {country}"
        logger.info(f"GMaps browser search: {query} (limit={limit})")

        page = await self._new_page()
        leads: list[GMapsLead] = []

        try:
            # Navigate to Google Maps
            await page.goto("https://www.google.com/maps", wait_until="domcontentloaded")
            await self._random_delay(2, 4)

            # Handle consent dialog
            try:
                consent = page.locator('button:has-text("Accept all"), button:has-text("Accept"), button:has-text("I agree")')
                if await consent.count() > 0:
                    await consent.first.click()
                    await self._random_delay(1, 2)
            except Exception:
                pass

            # Type search query
            search_box = page.locator('#searchboxinput')
            if await search_box.count() == 0:
                # Try alternative selector
                search_box = page.locator('input[type="text"], input[aria-label*="Search"]')

            await search_box.first.fill(query)
            await self._random_delay(0.5, 1)

            # Press Enter or click search button
            await search_box.first.press("Enter")
            await self._random_delay(3, 5)

            # Wait for results to load
            try:
                await page.wait_for_selector('[role="feed"], .Nv2PK, .section-result', timeout=15000)
            except Exception:
                logger.warning("Results feed not found, trying to scrape anyway")

            # Scroll through results to load more
            await self._scroll_results(page, limit)

            # Extract leads from the results feed
            leads = await self._extract_leads_from_feed(page, limit)

            # If feed extraction failed, try clicking individual results
            if not leads:
                leads = await self._extract_leads_by_clicking(page, limit)

            # For each lead with a website, try to get more details
            for i, lead in enumerate(leads[:limit]):
                if lead.website:
                    await self._enrich_lead_from_website(page, lead)
                    if i < len(leads) - 1:
                        await self._random_delay(1, 2)

        except Exception as e:
            logger.error(f"GMaps browser search failed: {e}")
        finally:
            await page.context.close()

        logger.info(f"GMaps browser search found {len(leads)} leads")
        return leads[:limit]

    async def _scroll_results(self, page: "Page", target_count: int):
        """Scroll the results feed to load more items."""
        feed = page.locator('[role="feed"]')
        if await feed.count() == 0:
            return

        for _ in range(10):  # Max 10 scroll attempts
            current_count = await page.locator('.Nv2PK, .section-result, [role="article"]').count()
            if current_count >= target_count:
                break

            try:
                await feed.first.evaluate("(el) => el.scrollTop = el.scrollHeight")
                await self._random_delay(1.5, 3)
            except Exception:
                break

    async def _extract_leads_from_feed(self, page: "Page", limit: int) -> list[GMapsLead]:
        """Extract lead data from the results feed panel."""
        leads: list[GMapsLead] = []

        # Try different selectors for result items
        selectors = ['.Nv2PK', '[role="article"]', '.section-result', '.bfdHYd']
        items = None
        for sel in selectors:
            items = page.locator(sel)
            if await items.count() > 0:
                break

        if not items or await items.count() == 0:
            return leads

        count = min(await items.count(), limit)
        for i in range(count):
            try:
                item = items.nth(i)
                lead = GMapsLead()

                # Business name
                name_el = item.locator('.qBF1Pd, .fontHeadlineSmall, .NrDZNb, [role="heading"]')
                if await name_el.count() > 0:
                    lead.business_name = (await name_el.first.inner_text()).strip()

                # Category / type
                cat_el = item.locator('.W4Efsd span:first-child, .fontBodyMedium .W4Efsd')
                if await cat_el.count() > 0:
                    lead.category = (await cat_el.first.inner_text()).strip()

                # Rating
                rating_el = item.locator('.MW4etd, span[aria-hidden="true"]')
                if await rating_el.count() > 0:
                    try:
                        lead.rating = float((await rating_el.first.inner_text()).strip().replace(",", "."))
                    except ValueError:
                        pass

                # Reviews count
                reviews_el = item.locator('.UY7F9')
                if await reviews_el.count() > 0:
                    try:
                        reviews_text = (await reviews_el.first.inner_text()).strip().replace("(", "").replace(")", "").replace(",", "")
                        lead.reviews = int(re.sub(r"[^\d]", "", reviews_text) or 0)
                    except (ValueError, AttributeError):
                        pass

                # Address
                addr_el = item.locator('.W4Efsd .W4Efsd span:last-child, .Io6YTe')
                if await addr_el.count() > 0:
                    lead.address = (await addr_el.first.inner_text()).strip()

                # Get the Google Maps link from the item
                link_el = item.locator("a[href*='/maps/place/']")
                if await link_el.count() > 0:
                    lead.google_maps_url = await link_el.first.get_attribute("href") or ""
                else:
                    # Click the item to get details
                    try:
                        await item.click()
                        await self._random_delay(1, 2)
                        lead.google_maps_url = page.url

                        # Try to get phone/website from the detail panel
                        await self._extract_details_from_panel(page, lead)

                        # Go back to results
                        await page.go_back()
                        await self._random_delay(1, 2)
                    except Exception:
                        pass

                if lead.business_name:
                    leads.append(lead)

            except Exception as e:
                logger.debug(f"Failed to extract lead {i}: {e}")
                continue

        return leads

    async def _extract_leads_by_clicking(self, page: "Page", limit: int) -> list[GMapsLead]:
        """Fallback: click each result item and extract from the detail panel."""
        leads: list[GMapsLead] = []
        result_links = page.locator('a[href*="/maps/place/"]')
        count = min(await result_links.count(), limit)

        for i in range(count):
            try:
                link = result_links.nth(i)
                name = (await link.get_attribute("aria-label")) or ""

                await link.click()
                await self._random_delay(2, 3)

                lead = GMapsLead(
                    business_name=name,
                    google_maps_url=await link.get_attribute("href") or "",
                )

                await self._extract_details_from_panel(page, lead)

                if lead.business_name:
                    leads.append(lead)

                # Close detail panel
                try:
                    back_btn = page.locator('button[aria-label="Back"], button[aria-label="Close"]')
                    if await back_btn.count() > 0:
                        await back_btn.first.click()
                        await self._random_delay(1, 2)
                except Exception:
                    pass

            except Exception as e:
                logger.debug(f"Failed to extract lead by clicking {i}: {e}")
                continue

        return leads

    async def _extract_details_from_panel(self, page: "Page", lead: GMapsLead):
        """Extract details from the right-side info panel after clicking a result."""
        try:
            # Address
            if not lead.address:
                addr = page.locator('[data-item-id="address"] .Io6YTe, button[data-item-id="address"]')
                if await addr.count() > 0:
                    lead.address = (await addr.first.inner_text()).strip()

            # Phone
            phone_el = page.locator('[data-item-id*="phone"] .Io6YTe, button[data-item-id*="phone"]')
            if await phone_el.count() > 0:
                lead.phone = (await phone_el.first.inner_text()).strip()

            # Website
            web_el = page.locator('[data-item-id="authority"] .Io6YTe, a[data-item-id="authority"]')
            if await web_el.count() > 0:
                lead.website = (await web_el.first.inner_text()).strip()
                if not lead.website.startswith("http"):
                    lead.website = "https://" + lead.website

            # Hours
            hours_el = page.locator('[data-item-id="oh"] .Io6YTe, button[data-item-id="oh"]')
            if await hours_el.count() > 0:
                lead.hours = (await hours_el.first.inner_text()).strip()

        except Exception as e:
            logger.debug(f"Failed to extract details from panel: {e}")

    async def _enrich_lead_from_website(self, page: "Page", lead: GMapsLead):
        """Visit the lead's website to extract email and phone."""
        if not lead.website:
            return

        try:
            new_page = await self._new_page()
            url = lead.website if lead.website.startswith("http") else f"https://{lead.website}"
            response = await new_page.goto(url, wait_until="domcontentloaded", timeout=15000)
            if not response or response.status >= 400:
                return

            await self._random_delay(1, 2)
            html = await new_page.content()
            text = await new_page.inner_text("body")

            # Extract email
            if not lead.phone:
                emails = re.findall(
                    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
                    html + text,
                )
                emails = [
                    e for e in emails
                    if not any(x in e.lower() for x in ["sentry", "example", "noreply", "test"])
                ]
                if emails:
                    lead.phone = ""  # Will be set below if found

            # Extract phone from website
            if not lead.phone:
                phones = re.findall(
                    r"(?:\+?\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}",
                    text,
                )
                phones = [p.strip() for p in phones if len(re.sub(r"\D", "", p)) >= 7]
                if phones:
                    lead.phone = phones[0]

            await new_page.context.close()

        except Exception as e:
            logger.debug(f"Failed to enrich lead from website {lead.website}: {e}")


async def search_google_maps_browser(
    niche: str,
    city: str,
    country: str = "",
    limit: int = 20,
    headless: bool = True,
) -> list[dict]:
    """Convenience function to search Google Maps via browser automation."""
    scraper = GMapsBrowserScraper(headless=headless)
    try:
        leads = await scraper.search(niche, city, country, limit)
        return [
            {
                "business_name": l.business_name,
                "address": l.address,
                "phone": l.phone,
                "email": "",
                "website": l.website,
                "category": l.category,
                "rating": l.rating,
                "reviews": l.reviews,
                "source": "google_maps_browser",
                "google_maps_url": l.google_maps_url,
            }
            for l in leads
        ]
    finally:
        await scraper.stop()
