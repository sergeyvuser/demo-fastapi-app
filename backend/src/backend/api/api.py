from fastapi import APIRouter

from backend.api.v1.api import router as api_v1_router
from backend.core.config import settings

router = APIRouter(prefix=settings.api.prefix)
router.include_router(api_v1_router)
