#!/usr/bin/env python3
"""Provision the dedicated test account the autopilot's browser self-test uses.

Creates (idempotently) an auth user, an organization it owns, and the minimum
data the app needs to render something on /clients, /tasks and /projects. Without
that data those routes render empty and the browser test degrades into "the page
did not crash", which is not a verification of anything.

The password is read from the environment and never written anywhere: not to a
file, not to argv, not to a log line. This script does not create `.env.e2e.local`
for you — put the same password there yourself.

Usage:

    E2E_EMAIL=autopilot-test@example.com \\
    E2E_PASSWORD='<a password you choose>' \\
    python3 backend/scripts/seed_e2e_account.py

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already in backend/.env).
Run it against a development or staging project — never production: it writes
rows and creates a user that can log in.
"""

from __future__ import annotations

import os
import sys
from typing import Any

# Make `backend.*` importable when run directly from the repository root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from supabase import Client, create_client  # noqa: E402

from backend.config import settings  # noqa: E402

ORG_NAME = "Autopilot E2E"
ORG_SLUG = "autopilot-e2e"


def fail(message: str) -> None:
    print(f"✖ {message}", file=sys.stderr)
    raise SystemExit(1)


def admin_client() -> Client:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        fail("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы (см. backend/.env)")
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)


def find_user(client: Client, email: str) -> Any | None:
    """Look for the account across the user list, one page at a time."""
    page = 1
    while page <= 20:
        users = client.auth.admin.list_users(page=page, per_page=200)
        if not users:
            return None
        for user in users:
            if (getattr(user, "email", "") or "").lower() == email.lower():
                return user
        if len(users) < 200:
            return None
        page += 1
    return None


def ensure_user(client: Client, email: str, password: str) -> str:
    existing = find_user(client, email)
    if existing is not None:
        # Re-running must not silently leave the account on an old password:
        # the whole point is that `.env.e2e.local` and the account agree.
        client.auth.admin.update_user_by_id(
            existing.id, {"password": password, "email_confirm": True}
        )
        print(f"• Пользователь уже существует, пароль обновлён: {email}")
        return str(existing.id)

    created = client.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            # Skip the confirmation mail: a test account must be able to log in
            # immediately and has no mailbox anyone reads.
            "email_confirm": True,
            "user_metadata": {"full_name": "Autopilot E2E"},
        }
    )
    user = getattr(created, "user", None) or created
    print(f"• Создан пользователь: {email}")
    return str(user.id)


def ensure_row(client: Client, table: str, match: dict[str, Any], payload: dict[str, Any]) -> str:
    """Insert a row unless one matching `match` already exists. Returns its id."""
    query = client.table(table).select("id")
    for column, value in match.items():
        query = query.eq(column, value)
    found = query.limit(1).execute()
    if found.data:
        return str(found.data[0]["id"])
    inserted = client.table(table).insert(payload).execute()
    if not inserted.data:
        fail(f"Не удалось создать запись в {table}")
    return str(inserted.data[0]["id"])


def seed(client: Client, user_id: str, email: str) -> str:
    client.table("profiles").upsert(
        {"id": user_id, "email": email, "full_name": "Autopilot E2E"}
    ).execute()

    org_id = ensure_row(
        client,
        "organizations",
        {"slug": ORG_SLUG},
        {"name": ORG_NAME, "slug": ORG_SLUG, "created_by": user_id},
    )
    client.table("organization_members").upsert(
        {"organization_id": org_id, "user_id": user_id, "role": "owner", "created_by": user_id},
        on_conflict="organization_id,user_id",
    ).execute()
    print(f"• Организация: {ORG_NAME} ({org_id})")

    project_id = ensure_row(
        client,
        "projects",
        {"organization_id": org_id, "name": "E2E Demo Project"},
        {
            "organization_id": org_id,
            "name": "E2E Demo Project",
            "description": "Фикстура для браузерного самотеста автопилота.",
            "status": "active",
            "priority": "medium",
            "created_by": user_id,
            "owner_id": user_id,
        },
    )
    print("• Проект: E2E Demo Project")

    for name, city, status in (
        ("Acme Coffee", "Berlin", "Lead"),
        ("Nordwind Logistics", "Hamburg", "In Progress"),
    ):
        ensure_row(
            client,
            "lead_clients",
            {"organization_id": org_id, "business_name": name},
            {
                "organization_id": org_id,
                "user_id": user_id,
                "business_name": name,
                "category": "E2E fixture",
                "city_location": city,
                "country": "Germany",
                "email": "",
                "website_url": "",
                "whatsapp_status": "",
                "status": status,
                "priority": "Middle",
            },
        )
    print("• Клиенты: Acme Coffee, Nordwind Logistics")

    for title, status in (("Проверить дашборд", "backlog"), ("Обновить прайс", "in_progress")):
        ensure_row(
            client,
            "tasks",
            {"organization_id": org_id, "title": title},
            {
                "organization_id": org_id,
                "project_id": project_id,
                "title": title,
                "description": "Фикстура для браузерного самотеста автопилота.",
                "status": status,
                "priority": "med",
                "created_by": user_id,
                "author_id": user_id,
            },
        )
    print("• Задачи: Проверить дашборд, Обновить прайс")
    return org_id


def main() -> None:
    email = (os.environ.get("E2E_EMAIL") or "").strip()
    password = os.environ.get("E2E_PASSWORD") or ""
    if not email or not password:
        fail(
            "Задайте E2E_EMAIL и E2E_PASSWORD в окружении.\n"
            "  Пример: E2E_EMAIL=autopilot-test@example.com E2E_PASSWORD='...' "
            "python3 backend/scripts/seed_e2e_account.py"
        )
    if len(password) < 8:
        fail("Пароль короче 8 символов — Supabase его отклонит")

    project_ref = settings.SUPABASE_URL.split("//", 1)[-1].split(".", 1)[0]
    print(f"Проект Supabase: {project_ref}")
    print("Убедитесь, что это НЕ продакшен: скрипт создаёт пользователя, который может войти.\n")

    client = admin_client()
    user_id = ensure_user(client, email, password)
    org_id = seed(client, user_id, email)

    print("\nГотово. Дальше:")
    print("  1. cp .env.e2e.example .env.e2e.local")
    print(f"  2. впишите AUTOPILOT_E2E_EMAIL={email} и тот же пароль в AUTOPILOT_E2E_PASSWORD")
    print("  3. AUTOPILOT_E2E_SUPABASE_ANON_KEY — публичный anon-ключ (не service-role)")
    print("  4. npx playwright test e2e/autopilot-smoke.spec.ts")
    print(f"\norganization_id для отладки: {org_id}")


if __name__ == "__main__":
    main()
