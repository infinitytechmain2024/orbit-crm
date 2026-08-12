from fastapi import APIRouter, Depends

from backend.auth import require_internal_token
from backend.config import settings

router = APIRouter(
    prefix="/api/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


@router.get("/health")
async def internal_health():
    return {"status": "ok", "service": settings.APP_NAME, "version": settings.APP_VERSION}