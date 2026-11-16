from fastapi import APIRouter

from backend.api.deps import CurrentVerifiedUserDep
from backend.api.ws.manager import WsStats, manager
from backend.core.exceptions import NotFoundError

# The operator's view, reached only from inside the network: not published.
router = APIRouter(tags=["Stats"], include_in_schema=False)


@router.get("/internal/ws-stats")
async def ws_stats(user: CurrentVerifiedUserDep) -> WsStats:
    if not user.is_superuser:
        raise NotFoundError("Not Found")
    return manager.stats()
