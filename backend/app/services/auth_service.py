"""Авторизация: пароли (PBKDF2), JWT (HS256) и сид демо-пользователей.

Все на стандартной библиотеке — без внешних зависимостей.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_PBKDF2_ITERATIONS = 120_000


# --- Пароли ----------------------------------------------------------------
def hash_password(password: str) -> str:
    """Хеширует пароль (PBKDF2-HMAC-SHA256), возвращает ``pbkdf2$...``."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Проверяет пароль по сохранённому хешу."""
    if not stored:
        return False
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


# --- JWT (HS256) ------------------------------------------------------------
def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_token(claims: dict[str, Any], secret: str, expire_days: int) -> str:
    """Создаёт JWT (HS256) со сроком жизни ``expire_days``."""
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {**claims, "iat": now, "exp": now + expire_days * 86_400}
    signing_input = (
        _b64encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        + "."
        + _b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64encode(signature)}"


def decode_token(token: str, secret: str) -> dict[str, Any] | None:
    """Проверяет подпись и срок JWT; возвращает claims или ``None``."""
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}"
        expected = hmac.new(
            secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(_b64encode(expected), signature_b64):
            return None
        payload = json.loads(_b64decode(payload_b64))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except (ValueError, KeyError, json.JSONDecodeError):
        return None


# --- Текущий пользователь ---------------------------------------------------
@dataclass
class AuthUser:
    """Пользователь, извлечённый из токена."""

    id: str
    login: str
    name: str
    role: str
    region_ids: list[str]
    engineer_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "login": self.login,
            "name": self.name,
            "role": self.role,
            "region_ids": self.region_ids,
            "engineer_id": self.engineer_id,
        }


def user_from_claims(claims: dict[str, Any]) -> AuthUser:
    """Собирает ``AuthUser`` из claims JWT."""
    return AuthUser(
        id=str(claims.get("sub", "")),
        login=claims.get("login", ""),
        name=claims.get("name", ""),
        role=claims.get("role", ""),
        region_ids=list(claims.get("region_ids", []) or []),
        engineer_id=claims.get("engineer_id"),
    )


def token_for_user(user, settings: Settings) -> str:
    """Выпускает токен для записи пользователя (модель ``User``)."""
    return create_token(
        {
            "sub": user.id,
            "login": user.login,
            "name": user.name,
            "role": user.role,
            "region_ids": list(user.region_ids or []),
            "engineer_id": user.engineer_id,
        },
        settings.jwt_secret,
        settings.jwt_expire_days,
    )


# --- Сид демо-пользователей -------------------------------------------------
def seed_demo_users(repository) -> int:
    """Создаёт демо-учётки (идемпотентно). Возвращает число созданных."""
    from app.core.regions import REGIONS
    from app.services.region_dataset import build_region_scenario

    settings = get_settings()
    password_hash = hash_password(settings.demo_password)
    created = 0
    demo_users = [
        {"login": "dispatcher", "name": "Диспетчер", "role": "dispatcher",
         "region_ids": list(REGIONS.keys()), "engineer_id": None},
        {"login": "operator", "name": "Оператор", "role": "operator",
         "region_ids": list(REGIONS.keys()), "engineer_id": None},
    ]
    # Инженеры по ростеру каждого региона (id/имя совпадают с демо-набором).
    region_prefix = {"east": "east", "south_east": "se", "south_center": "sc"}
    for region_id, region in REGIONS.items():
        engineers = build_region_scenario(region_id)["engineers"]
        for index, engineer in enumerate(engineers, start=1):
            demo_users.append(
                {
                    "login": f"eng-{region_prefix[region_id]}-{index:02d}",
                    "name": engineer["name"],
                    "role": "engineer",
                    "region_ids": [region_id],
                    "engineer_id": engineer["id"],
                }
            )

    for item in demo_users:
        if repository.get_user_by_login(item["login"]) is None:
            repository.create_user(
                login=item["login"],
                name=item["name"],
                role=item["role"],
                password_hash=password_hash,
                region_ids=item["region_ids"],
                engineer_id=item["engineer_id"],
            )
            created += 1
    if created:
        logger.info("Создано демо-пользователей: %s", created)
    return created
