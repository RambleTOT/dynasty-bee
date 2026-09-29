"""Переиспользуемые описания ответов об ошибках для OpenAPI/Swagger."""
from __future__ import annotations

from app.schemas.common import ErrorResponse

NOT_FOUND_RESPONSE = {
    404: {
        "model": ErrorResponse,
        "description": "Объект не найден (сценарий, план или событие).",
    }
}

VALIDATION_RESPONSE = {
    422: {
        "model": ErrorResponse,
        "description": (
            "Ошибка валидации входных данных или невозможность построить план. "
            "Поле `context.errors` содержит детали."
        ),
    }
}

INTERNAL_RESPONSE = {
    500: {
        "model": ErrorResponse,
        "description": "Внутренняя ошибка сервиса.",
    }
}


def error_responses(*kinds: str) -> dict:
    """Собирает словарь ответов об ошибках по именам: not_found/validation/internal."""
    mapping = {
        "not_found": NOT_FOUND_RESPONSE,
        "validation": VALIDATION_RESPONSE,
        "internal": INTERNAL_RESPONSE,
    }
    result: dict = {}
    for kind in kinds:
        result.update(mapping[kind])
    return result
