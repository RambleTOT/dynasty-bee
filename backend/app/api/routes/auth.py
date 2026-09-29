"""Аутентификация: вход по логину/паролю, профиль, выход (D-17)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field

from app.api.deps import get_repository, verify_token
from app.core.config import get_settings
from app.schemas.extras import UserOut
from app.services.auth_service import (
    AuthUser,
    token_for_user,
    user_from_claims,
    verify_password,
)
from app.storage.repository import Repository

router = APIRouter(prefix="/auth", tags=["Авторизация"])


class LoginIn(BaseModel):
    """Учётные данные для входа."""

    login: str = Field(..., description="Логин")
    password: str = Field(..., description="Пароль")


class LoginOut(BaseModel):
    """Ответ входа: токен и профиль."""

    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post(
    "/login",
    response_model=LoginOut,
    summary="Вход по логину и паролю",
    responses={401: {"description": "Неверный логин или пароль"}},
)
def login(payload: LoginIn, repository: Repository = Depends(get_repository)) -> LoginOut:
    """Проверяет логин/пароль и выдаёт JWT."""
    from fastapi import HTTPException

    user = repository.get_user_by_login(payload.login.strip())
    if user is None or not user.active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "UNAUTHORIZED", "message": "Неверный логин или пароль"}},
        )
    settings = get_settings()
    return LoginOut(
        access_token=token_for_user(user, settings),
        user=UserOut(
            id=user.id,
            login=user.login,
            name=user.name,
            role=user.role,
            region_ids=list(user.region_ids or []),
            engineer_id=user.engineer_id,
        ),
    )


@router.get(
    "/me",
    response_model=UserOut,
    summary="Профиль текущего пользователя",
)
def me(user: AuthUser = Depends(verify_token)) -> UserOut:
    """Возвращает профиль по токену."""
    return UserOut(**user.as_dict())


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Выход (клиент удаляет токен)",
)
def logout(user: AuthUser = Depends(verify_token)) -> Response:
    """JWT stateless: достаточно удалить токен на клиенте."""
    return Response(status_code=status.HTTP_204_NO_CONTENT)
