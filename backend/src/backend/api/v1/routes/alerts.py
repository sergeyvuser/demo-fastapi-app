import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from backend.api.deps import CurrentUserDep, CurrentVerifiedUserDep, RedisDep
from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.models.alert import AlertStatus
from backend.schemas.alert import AlertCreate, AlertRead, AlertUpdate
from backend.schemas.pagination import Page
from backend.services.alert import AlertService
from backend.services.prices import PriceCache

router = APIRouter(prefix=settings.api.v1.alerts, tags=["Alerts"])


def get_alert_service(session: AsyncSessionDep, redis: RedisDep) -> AlertService:
    """One place that knows what an AlertService is made of."""
    return AlertService(session=session, prices=PriceCache(redis))


AlertServiceDep = Annotated[AlertService, Depends(get_alert_service)]


@router.post("", response_model=AlertRead, status_code=status.HTTP_201_CREATED)
async def create_alert(
    data: AlertCreate,
    user: CurrentVerifiedUserDep,
    service: AlertServiceDep,
):
    return await service.create(user_id=user.id, data=data)


@router.get("", response_model=Page[AlertRead])
async def list_alerts(
    user: CurrentUserDep,
    service: AlertServiceDep,
    status_filter: Annotated[AlertStatus | None, Query(alias="status")] = None,
    symbol: str | None = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    items, total = await service.list(
        user.id, status=status_filter, symbol=symbol, skip=skip, limit=limit
    )
    return Page(items=items, total=total, skip=skip, limit=limit)


@router.get("/{alert_id}", response_model=AlertRead)
async def get_alert(
    alert_id: uuid.UUID,
    user: CurrentUserDep,
    service: AlertServiceDep,
):
    return await service.get(alert_id=alert_id, user_id=user.id)


@router.patch("/{alert_id}", response_model=AlertRead)
async def update_alert(
    alert_id: uuid.UUID,
    data: AlertUpdate,
    user: CurrentUserDep,
    service: AlertServiceDep,
):
    return await service.update(alert_id=alert_id, user_id=user.id, data=data)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: uuid.UUID,
    user: CurrentUserDep,
    service: AlertServiceDep,
):
    await service.delete(alert_id=alert_id, user_id=user.id)
