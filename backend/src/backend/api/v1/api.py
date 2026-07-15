from fastapi import APIRouter

from backend.core.config import settings

from .routes.alerts import router as alerts_router
from .routes.auth import router as auth_router
from .routes.users import router as users_router

router = APIRouter(prefix=settings.api.v1.prefix)
router.include_router(users_router)
router.include_router(auth_router)
router.include_router(alerts_router)
