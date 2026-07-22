import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from backend.api.deps import CurrentUserDep, CurrentVerifiedUserDep
from backend.core.config import settings
from backend.core.db import AsyncSessionDep
from backend.models.alert import AlertStatus
from backend.schemas.alert import AlertCreate, AlertRead, AlertUpdate
from backend.schemas.pagination import Page
from backend.services.alert import AlertService

router = APIRouter(prefix=settings.api.v1.alerts, tags=["Alerts"])


@router.post("", response_model=AlertRead, status_code=status.HTTP_201_CREATED)
async def create_alert(
    data: AlertCreate,
    user: CurrentVerifiedUserDep,
    session: AsyncSessionDep,
):
    return await AlertService(session=session).create(user_id=user.id, data=data)


@router.get("", response_model=Page[AlertRead])
async def list_alerts(
    user: CurrentUserDep,
    session: AsyncSessionDep,
    status_filter: Annotated[AlertStatus | None, Query(alias="status")] = None,
    symbol: str | None = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    items, total = await AlertService(session=session).list(
        user.id, status=status_filter, symbol=symbol, skip=skip, limit=limit
    )
    return Page(items=items, total=total, skip=skip, limit=limit)


@router.get("/{alert_id}", response_model=AlertRead)
async def get_alert(
    alert_id: uuid.UUID,
    user: CurrentUserDep,
    session: AsyncSessionDep,
):
    return await AlertService(session=session).get(alert_id=alert_id, user_id=user.id)


@router.patch("/{alert_id}", response_model=AlertRead)
async def update_alert(
    alert_id: uuid.UUID,
    data: AlertUpdate,
    user: CurrentUserDep,
    session: AsyncSessionDep,
):
    return await AlertService(session=session).update(
        alert_id=alert_id, user_id=user.id, data=data
    )


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_alert(
    alert_id: uuid.UUID,
    user: CurrentUserDep,
    session: AsyncSessionDep,
):
    await AlertService(session=session).delete(alert_id=alert_id, user_id=user.id)
