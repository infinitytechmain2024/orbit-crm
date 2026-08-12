from fastapi import Header, HTTPException

from backend.config import settings


async def require_internal_token(authorization: str = Header(default="")):
    expected = settings.INTERNAL_API_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Internal API token is not configured")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")