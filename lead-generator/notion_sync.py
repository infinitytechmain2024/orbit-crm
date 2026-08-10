"""Notion API integration for syncing leads to a Notion database."""

import os
import re
from datetime import datetime

from notion_client import Client as NotionClient

from models import Lead, NotionSyncResult


def get_notion_client() -> NotionClient:
    """Initialize and return Notion client."""
    api_key = os.getenv("NOTION_API_KEY", "")
    if not api_key:
        raise ValueError("NOTION_API_KEY environment variable is required")
    return NotionClient(auth=api_key)


def parse_leads_from_markdown(filepath: str) -> list[Lead]:
    """Parse leads from a Markdown report file."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    leads = []
    # Split by lead sections (### N. Name)
    sections = re.split(r"### \d+\.\s+", content)

    for section in sections[1:]:  # Skip header
        lead = Lead(name="", company="")

        # Extract name
        name_match = re.match(r"(.+?)(?:\s*—\s*(.+))?$", section.split("\n")[0].strip())
        if name_match:
            lead.name = name_match.group(1).strip()
            if name_match.group(2):
                lead.company = name_match.group(2).strip()

        # Extract ICP Score
        score_match = re.search(r"ICP Score.*?`(\d+)/10`", section)
        if score_match:
            lead.icp_score = int(score_match.group(1))

        # Extract email
        email_match = re.search(r"📧\s*\[?([^\]\s]+@[^\]\s]+)\]?", section)
        if email_match:
            lead.email = email_match.group(1)

        # Extract phone
        phone_match = re.search(r"📱\s*([+\d\s\-()]+)", section)
        if phone_match:
            lead.phone = phone_match.group(1).strip()

        # Extract website
        website_match = re.search(r"🌐\s*\[([^\]]+)\]\(([^)]+)\)", section)
        if website_match:
            lead.website = website_match.group(2)

        # Extract LinkedIn
        linkedin_match = re.search(r"💼\s*\[LinkedIn\]\(([^)]+)\)", section)
        if linkedin_match:
            lead.linkedin = linkedin_match.group(1)

        # Extract source URL
        source_match = re.search(r"🔗 Источник:\s*(https?://\S+)", section)
        if source_match:
            lead.source_url = source_match.group(1)

        # Extract analysis (between "Анализ соответствия ICP:" and next section)
        analysis_match = re.search(
            r"Анализ соответствия ICP:\s*\n(.+?)(?=\n\*\*Рекомендуемый|\n---|\Z)",
            section,
            re.DOTALL,
        )
        if analysis_match:
            lead.analysis = analysis_match.group(1).strip()

        # Extract outreach approach
        outreach_match = re.search(
            r"Рекомендуемый подход к первому контакту:\s*\n(.+?)(?=\n---|\Z)",
            section,
            re.DOTALL,
        )
        if outreach_match:
            lead.outreach_approach = outreach_match.group(1).strip()

        # Extract description
        desc_match = re.search(
            r"\*\*Описание:\*\*\s*\n(.+?)(?=\n\*\*Анализ|\n---|\Z)",
            section,
            re.DOTALL,
        )
        if desc_match:
            lead.description = desc_match.group(1).strip()

        if lead.name:
            leads.append(lead)

    return leads


def check_duplicate(database_id: str, lead: Lead, notion: NotionClient) -> bool:
    """Check if a lead already exists in the Notion database."""
    try:
        results = notion.databases.query(
            database_id=database_id,
            filter={
                "and": [
                    {
                        "property": "Name",
                        "title": {"equals": lead.name},
                    },
                    {
                        "property": "Company",
                        "rich_text": {"equals": lead.company},
                    },
                ]
            },
        )
        return len(results.get("results", [])) > 0
    except Exception:
        return False


def create_notion_page(database_id: str, lead: Lead, notion: NotionClient) -> str:
    """Create a new page in Notion database for a lead."""
    properties = {
        "Name": {"title": [{"text": {"content": lead.name}}]},
        "Company": {"rich_text": [{"text": {"content": lead.company or "N/A"}}]},
        "Industry": {"rich_text": [{"text": {"content": lead.industry or "N/A"}}]},
        "Location": {"rich_text": [{"text": {"content": lead.location or "N/A"}}]},
        "ICP Score": {"number": lead.icp_score},
        "Status": {"status": {"name": "New"}},
        "Created At": {"date": {"start": datetime.now().isoformat()}},
    }

    if lead.email:
        properties["Email"] = {"email": lead.email}
    if lead.phone:
        properties["Phone"] = {"rich_text": [{"text": {"content": lead.phone}}]}
    if lead.website:
        properties["Website"] = {"url": lead.website}
    if lead.linkedin:
        properties["LinkedIn"] = {"url": lead.linkedin}

    # Description as page content
    children = [
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"text": {"content": "Description"}}]},
        },
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"text": {"content": lead.description or "N/A"}}]},
        },
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"text": {"content": "ICP Analysis"}}]},
        },
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"text": {"content": lead.analysis or "N/A"}}]},
        },
        {
            "object": "block",
            "type": "heading_2",
            "heading_2": {
                "rich_text": [{"text": {"content": "Recommended Outreach"}}],
            },
        },
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"text": {"content": lead.outreach_approach or "N/A"}}],
            },
        },
    ]

    page = notion.pages.create(
        database_id=database_id,
        properties=properties,
        children=children,
    )

    return page["id"]


def sync_leads_to_notion(
    filepath: str,
    database_id: str | None = None,
    overwrite: bool = False,
) -> NotionSyncResult:
    """Sync leads from Markdown report to Notion database.

    Args:
        filepath: Path to the Markdown report file.
        database_id: Notion database ID. If None, reads from env.
        overwrite: If True, skip duplicate check.

    Returns:
        NotionSyncResult with counts.
    """
    db_id = database_id or os.getenv("NOTION_DATABASE_ID", "")
    if not db_id:
        raise ValueError("Notion database ID is required")

    notion = get_notion_client()
    leads = parse_leads_from_markdown(filepath)

    synced = 0
    skipped = 0
    errors = 0

    for lead in leads:
        try:
            if not overwrite and check_duplicate(db_id, lead, notion):
                skipped += 1
                continue

            page_id = create_notion_page(db_id, lead, notion)
            lead.notion_page_id = page_id
            synced += 1
        except Exception as e:
            print(f"Error syncing lead '{lead.name}': {e}")
            errors += 1

    return NotionSyncResult(
        synced=synced,
        skipped=skipped,
        errors=errors,
        database_url=f"https://notion.so/{db_id.replace('-', '')}",
    )
