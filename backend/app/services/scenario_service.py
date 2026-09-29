"""Сервис подготовки и чтения сценариев.

Отвечает за:
* нормализацию входных данных (координаты, справочники);
* демонстрационное геокодирование адресов без координат;
* построение сводок и полных представлений сценария;
* разбор CSV-файлов, загруженных пользователем.
"""
from __future__ import annotations

import csv
import io
from typing import Any

from app.core.config import get_settings
from app.schemas.engineer import EngineerOut
from app.schemas.request import RequestOut
from app.schemas.scenario import ScenarioOut, ScenarioSummary
from app.services.geo import demo_geocode
from app.storage.models import Scenario

_CSV_SKILL_SEPARATORS = (";", "|", ",")


def _ensure_coordinates(request: dict[str, Any], allow_demo_geocoding: bool) -> bool:
    """Заполняет координаты заявки по адресу, если их нет.

    Возвращает ``True``, если координаты были получены демонстрационным
    геокодером.
    """
    if request.get("latitude") is not None and request.get("longitude") is not None:
        return False
    address = request.get("address")
    if not address:
        raise ValueError(
            f"Заявка {request.get('id')}: нужны координаты (latitude/longitude) или адрес"
        )
    if not allow_demo_geocoding:
        raise ValueError(
            f"Заявка {request.get('id')}: геокодирование отключено, задайте координаты"
        )
    latitude, longitude = demo_geocode(str(address))
    request["latitude"] = latitude
    request["longitude"] = longitude
    return True


def prepare_requests(requests: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Готовит список заявок к хранению и расчёту."""
    settings = get_settings()
    prepared: list[dict[str, Any]] = []
    warnings: list[str] = []
    for raw in requests:
        request = dict(raw)
        if _ensure_coordinates(request, settings.allow_demo_geocoding):
            warnings.append(
                f"Заявка {request['id']}: координаты получены демонстрационным геокодером по адресу"
            )
        request.setdefault("release_time", 0)
        prepared.append(request)
    return prepared, warnings


def build_summary(scenario: Scenario) -> ScenarioSummary:
    """Собирает краткую сводку по сценарию."""
    metadata = scenario.scenario_metadata or {}
    skills = sorted({skill for engineer in scenario.engineers for skill in engineer.get("skills", [])})
    transports = sorted(
        {engineer.get("transport") for engineer in scenario.engineers if engineer.get("transport")}
    )
    return ScenarioSummary(
        scenario_id=scenario.id,
        name=scenario.name,
        description=scenario.description,
        created_at=scenario.created_at,
        engineer_count=len(scenario.engineers),
        request_count=len(scenario.requests),
        skills=skills,
        transports=transports,
        region_id=metadata.get("region_id"),
        date=metadata.get("date"),
        source=metadata.get("source"),
        import_report=metadata.get("import_report"),
    )


def build_scenario_out(scenario: Scenario) -> ScenarioOut:
    """Собирает полное представление сценария для API."""
    metadata = scenario.scenario_metadata or {}
    return ScenarioOut(
        scenario_id=scenario.id,
        name=scenario.name,
        description=scenario.description,
        created_at=scenario.created_at,
        scenario_metadata=metadata,
        region_id=metadata.get("region_id"),
        date=metadata.get("date"),
        source=metadata.get("source"),
        office=metadata.get("office"),
        active_plan_id=metadata.get("active_plan_id"),
        draft_plan_id=metadata.get("draft_plan_id"),
        clock=metadata.get("clock"),
        engineers=[EngineerOut.from_raw(item) for item in scenario.engineers],
        requests=[RequestOut.from_dict(item) for item in scenario.requests],
    )


def load_demo_scenario() -> dict[str, Any]:
    """Читает встроенный демонстрационный сценарий."""
    import json

    settings = get_settings()
    path = settings.demo_scenario_path
    if not path.exists():
        raise FileNotFoundError(f"Демо-сценарий не найден: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


# --- CSV ---------------------------------------------------------------
def _split_skills(value: str) -> list[str]:
    """Разбирает строку навыков, разделённых ``;``, ``|`` или ``,``."""
    for separator in _CSV_SKILL_SEPARATORS:
        if separator in value:
            return [item.strip() for item in value.split(separator) if item.strip()]
    return [value.strip()] if value.strip() else []


def _parse_optional_float(value: str | None) -> float | None:
    """Парсит необязательное вещественное число."""
    if value is None or str(value).strip() == "":
        return None
    return float(str(value).replace(",", "."))


def _parse_bool(value: str | None, default: bool = True) -> bool:
    """Парсит булево значение из CSV."""
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip().lower() in {"1", "true", "да", "yes", "y"}


def parse_engineers_csv(content: bytes) -> list[dict[str, Any]]:
    """Разбирает CSV со списком инженеров."""
    text = _decode_csv(content)
    reader = csv.DictReader(io.StringIO(text))
    engineers: list[dict[str, Any]] = []
    for row in reader:
        row = {str(key).strip(): (value or "").strip() for key, value in row.items() if key}
        if not row.get("id"):
            continue
        engineers.append(
            {
                "id": row["id"],
                "name": row.get("name") or row["id"],
                "latitude": _parse_optional_float(row.get("latitude")),
                "longitude": _parse_optional_float(row.get("longitude")),
                "shift_start": row.get("shift_start", "09:00"),
                "shift_end": row.get("shift_end", "18:00"),
                "skills": _split_skills(row.get("skills", "")),
                "transport": row.get("transport", "car"),
                "available": _parse_bool(row.get("available")),
            }
        )
    return engineers


def parse_requests_csv(content: bytes) -> list[dict[str, Any]]:
    """Разбирает CSV со списком заявок."""
    text = _decode_csv(content)
    reader = csv.DictReader(io.StringIO(text))
    requests: list[dict[str, Any]] = []
    for row in reader:
        row = {str(key).strip(): (value or "").strip() for key, value in row.items() if key}
        if not row.get("id"):
            continue
        requests.append(
            {
                "id": row["id"],
                "latitude": _parse_optional_float(row.get("latitude")),
                "longitude": _parse_optional_float(row.get("longitude")),
                "address": row.get("address") or None,
                "duration_minutes": int(float(row.get("duration_minutes", "0") or 0)),
                "window_start": row.get("window_start", "09:00"),
                "window_end": row.get("window_end", "18:00"),
                "priority": row.get("priority") or "normal",
                "required_skill": row.get("required_skill", ""),
                "required_transport": row.get("required_transport") or None,
            }
        )
    return requests


def _decode_csv(content: bytes) -> str:
    """Декодирует CSV в UTF-8 (с поддержкой BOM) или cp1251."""
    for encoding in ("utf-8-sig", "cp1251"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Не удалось определить кодировку CSV (ожидается UTF-8 или CP1251)")
