"""Маршруты загрузки и просмотра входных данных."""
from __future__ import annotations

import json

from fastapi import Security, APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import verify_token, get_app_settings, get_repository
from app.api.responses import error_responses
from app.core.config import Settings
from app.core.regions import get_region, is_builtin
from app.schemas.common import MessageResponse
from app.schemas.engineer import EngineerIn
from app.schemas.request import RequestIn
from app.schemas.scenario import (
    ScenarioIn,
    ScenarioListResponse,
    ScenarioOut,
    ScenarioSummary,
)
from app.services import scenario_service
from app.services.beeline_import import ImportError_, import_beeline
from app.services.region_dataset import build_region_scenario
from app.storage.repository import Repository

router = APIRouter(prefix="/data", tags=["Данные"], dependencies=[Security(verify_token)])


def _guard_day_conflict(
    repository: Repository, region_id: str, date: str, source: str
) -> list[dict]:
    """Правило «один живой день на (регион, дата)» (п. 29, 30, 31).

    Возвращает живые записи оператора, которые нужно перенести в новый день.
    Если на дату есть настоящий день (CSV/демо) и живые записи оператора —
    загрузка файлов запрещена (`409`). Если день состоял только из записей
    оператора — он уходит в архив, а записи переносятся в новый день (п. 30).
    """
    existing = [
        item
        for item in repository.find_scenarios(region_id=region_id, date=date, limit=50)
        if not (item.scenario_metadata or {}).get("archived")
    ]

    def _active_operator(item):
        # Отменённые и перенесённые записи не считаются живыми (п. 29).
        return [
            r
            for r in item.requests
            if r.get("source") == "operator"
            and r.get("status") not in {"cancelled", "rescheduled"}
        ]

    has_real_day = any(
        (item.scenario_metadata or {}).get("source") != "booking" for item in existing
    )
    live_operator = sum((len(_active_operator(item)) for item in existing), 0)
    if live_operator and source != "booking" and has_real_day:
        booking = next(item for item in existing if _active_operator(item))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": {
                    "code": "DATE_HAS_BOOKINGS",
                    "message": (
                        f"На {date} в регионе {region_id} уже {live_operator} записей "
                        f"оператора. Выберите другую дату"
                    ),
                    "details": {"scenario_id": booking.id},
                }
            },
        )
    carried: list[dict] = []
    # Полная замена дня: архивируем все прежние живые сценарии этой даты (п. 31),
    # живые записи оператора переносим (п. 30).
    for item in existing:
        carried.extend(_active_operator(item))
        meta = dict(item.scenario_metadata or {})
        meta["archived"] = True
        item.scenario_metadata = meta
        repository.update_scenario(item)
    return _clean_carried_requests(carried)


def _clean_carried_requests(requests: list[dict]) -> list[dict]:
    """Приводит переносимые записи к формату заявки входа (без служебных полей)."""
    from app.schemas.request import RequestIn

    cleaned: list[dict] = []
    for raw in requests:
        item = {k: v for k, v in raw.items() if not k.startswith("_") and k != "status"}
        try:
            cleaned.append(RequestIn(**item).model_dump())
        except Exception:  # noqa: BLE001 — некорректную запись не переносим
            continue
    return cleaned


def _validate_limits(engineer_count: int, request_count: int, settings: Settings) -> None:
    """Проверяет ограничения на размер сценария."""
    if engineer_count > settings.max_engineers:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Слишком много инженеров: {engineer_count} (максимум {settings.max_engineers})",
        )
    if request_count > settings.max_requests:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Слишком много заявок: {request_count} (максимум {settings.max_requests})",
        )


def _store_scenario(
    repository: Repository,
    settings: Settings,
    name: str,
    description: str | None,
    engineers: list[dict],
    requests: list[dict],
    scenario_metadata: dict | None = None,
) -> ScenarioSummary:
    """Готовит и сохраняет сценарий, возвращает его сводку."""
    _validate_limits(len(engineers), len(requests), settings)
    prepared_requests, warnings = scenario_service.prepare_requests(requests)
    metadata = dict(scenario_metadata or {})
    if warnings:
        metadata["geocoding_warnings"] = warnings
    scenario = repository.create_scenario(
        engineers=engineers,
        requests=prepared_requests,
        name=name,
        description=description,
        scenario_metadata=metadata,
    )
    # Живое обновление: создан день (§38).
    try:
        from app.realtime.hub import hub

        if metadata.get("region_id") and metadata.get("date"):
            hub.publish(
                "day.created",
                region_id=metadata.get("region_id"),
                date=metadata.get("date"),
                data={
                    "scenario_id": scenario.id,
                    "source": metadata.get("source"),
                    "request_count": len(prepared_requests),
                },
            )
    except Exception:  # noqa: BLE001
        pass
    return scenario_service.build_summary(scenario)


def _publish_roster_changed(scenario) -> None:
    """Живое обновление: состав бригад дня изменился (§38)."""
    try:
        from app.realtime.hub import hub

        meta = scenario.scenario_metadata or {}
        hub.publish(
            "roster.changed",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={"scenario_id": scenario.id},
        )
    except Exception:  # noqa: BLE001
        pass


@router.post(
    "/load",
    response_model=ScenarioSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить сценарий (JSON)",
    response_description="Сводка сохранённого сценария с его `scenario_id`.",
    responses=error_responses("validation", "internal"),
    description=(
        "Принимает списки инженеров и заявок, проверяет справочники и координаты "
        "и сохраняет сценарий как текущий рабочий набор данных. Координаты заявки "
        "можно не указывать, если задан `address` (включено демо-геокодирование)."
    ),
)
def load_scenario(
    payload: ScenarioIn,
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_app_settings),
) -> ScenarioSummary:
    """Сохраняет входные данные, переданные в теле запроса."""
    engineers = [engineer.model_dump() for engineer in payload.engineers]
    requests = [request.model_dump() for request in payload.requests]
    return _store_scenario(
        repository,
        settings,
        name=payload.name,
        description=payload.description,
        engineers=engineers,
        requests=requests,
        scenario_metadata=payload.scenario_metadata,
    )


@router.post(
    "/load-demo",
    response_model=ScenarioSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить демонстрационный набор (регион или встроенный)",
    response_description="Сводка демо-сценария.",
    responses=error_responses("internal"),
    description=(
        "`?region_id=east|south_east|south_center` загружает синтетический рабочий день "
        "региона (12/12/11 инженеров, 66/83/56 заявок). Без параметра — встроенный набор."
    ),
)
def load_demo(
    region_id: str | None = Query(None, description="ID региона; иначе встроенный демо-набор"),
    date: str | None = Query(None, description="Дата дня YYYY-MM-DD (по умолчанию — сегодня)"),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_app_settings),
) -> ScenarioSummary:
    """Загружает демонстрационный сценарий региона или встроенный набор."""
    from app.core.timeutils import today_str

    if region_id:
        # демо-набор есть только у участков кейса; своему участку (§14) — 404
        if not is_builtin(region_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Неизвестный регион: {region_id}"
            )
        target_date = date or today_str()
        carried = _guard_day_conflict(repository, region_id, target_date, "demo")
        demo = build_region_scenario(region_id, target_date)
        demo["requests"].extend(carried)
        metadata = demo["scenario_metadata"]
    else:
        try:
            demo = scenario_service.load_demo_scenario()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        metadata = demo.get("metadata", demo.get("scenario_metadata", {})) or {}
    engineers = [EngineerIn(**item).model_dump() for item in demo["engineers"]]
    requests = [RequestIn(**item).model_dump() for item in demo["requests"]]
    return _store_scenario(
        repository,
        settings,
        name=demo.get("name", "Демонстрационный сценарий"),
        description=demo.get("description"),
        engineers=engineers,
        requests=requests,
        scenario_metadata=metadata,
    )


@router.post(
    "/import-beeline",
    response_model=ScenarioSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Импорт выданного CSV Билайна",
    response_description="Сводка дня и отчёт импорта.",
    responses=error_responses("validation"),
    description=(
        "Принимает CSV Билайна (cp1251/utf-8, разделитель `;`), опционально контрольный файл "
        "и файл инженеров. Определяет регион, маппит типы заявок в навыки и длительности, "
        "применяет правило требуемого транспорта, геокодирует адреса."
    ),
)
async def import_beeline_csv(
    requests_file: UploadFile = File(..., description="CSV с заявками (выданный формат)"),
    control_file: UploadFile | None = File(None, description="Контрольный файл (Бригада, Статус BK)"),
    engineers_file: UploadFile | None = File(None, description="Ростер инженеров (CSV)"),
    region_id: str | None = Form(None, description="ID региона, если не определяется по офису"),
    date: str | None = Form(None, description="Дата дня YYYY-MM-DD (по умолчанию — сегодня)"),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_app_settings),
) -> ScenarioSummary:
    """Импортирует CSV Билайна и сохраняет рабочий день."""
    from app.core.timeutils import today_str
    from app.services.geocoder import Geocoder

    region = get_region(region_id, repository) if region_id else None
    if region_id and region is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "REGION_UNKNOWN", "message": f"Нет участка {region_id}", "details": {}}},
        )
    try:
        scenario, report = import_beeline(
            await requests_file.read(),
            control_content=await control_file.read() if control_file else None,
            engineers_content=await engineers_file.read() if engineers_file else None,
            region_id=region_id,
            date=date or today_str(),
            geocoder=Geocoder(repository, settings),
            region=region,
        )
    except ImportError_ as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": exc.code, "message": str(exc), "details": exc.details}},
        ) from exc
    scenario_region = scenario["scenario_metadata"].get("region_id")
    scenario_date = scenario["scenario_metadata"].get("date")
    if scenario_region and scenario_date:
        carried = _guard_day_conflict(repository, scenario_region, scenario_date, "csv")
        scenario["requests"].extend(carried)
    engineers = [EngineerIn(**item).model_dump() for item in scenario["engineers"]]
    requests = [RequestIn(**item).model_dump() for item in scenario["requests"]]
    metadata = dict(scenario["scenario_metadata"])
    metadata["import_report"] = report
    summary = _store_scenario(
        repository,
        settings,
        name=scenario["name"],
        description=scenario["description"],
        engineers=engineers,
        requests=requests,
        scenario_metadata=metadata,
    )
    summary.import_report = report
    # свой участок (§14): число заявок и контрольный файл последней загрузки — для GET /regions
    if scenario_region and not is_builtin(scenario_region):
        record = repository.get_region_record(scenario_region)
        if record is not None:
            record.request_count = len(requests)
            record.has_control = control_file is not None
            repository.save_region_record(record)
    return summary


@router.post(
    "/load-files",
    response_model=ScenarioSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Загрузить сценарий из JSON/CSV файлов",
    response_description="Сводка сохранённого сценария с его `scenario_id`.",
    responses=error_responses("validation", "internal"),
    description=(
        "Принимает два файла (инженеры и заявки) в формате JSON или CSV. "
        "CSV должен содержать заголовки: для инженеров — id,name,latitude,longitude,"
        "shift_start,shift_end,skills,transport; для заявок — id,latitude,longitude,address,"
        "duration_minutes,window_start,window_end,priority,required_skill,required_transport. "
        "Навыки в CSV разделяются символом ';'."
    ),
)
async def load_files(
    engineers_file: UploadFile | None = File(None, description="Файл с инженерами (JSON или CSV)"),
    requests_file: UploadFile | None = File(None, description="Файл с заявками (JSON или CSV)"),
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_app_settings),
) -> ScenarioSummary:
    """Разбирает загруженные файлы и сохраняет сценарий."""
    if engineers_file is None or requests_file is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Нужно приложить оба файла: engineers_file и requests_file",
        )
    try:
        engineers_raw = _read_structured(await engineers_file.read(), engineers_file.filename or "")
        requests_raw = _read_structured(await requests_file.read(), requests_file.filename or "")
        engineers = [EngineerIn(**item).model_dump() for item in engineers_raw]
        requests = [RequestIn(**item).model_dump() for item in requests_raw]
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return _store_scenario(
        repository,
        settings,
        name="Загруженный сценарий",
        description=f"Источники: {engineers_file.filename}, {requests_file.filename}",
        engineers=engineers,
        requests=requests,
    )


def _read_structured(content: bytes, filename: str) -> list[dict]:
    """Читает JSON- или CSV-файл в список словарей."""
    lowered = filename.lower()
    if lowered.endswith(".json"):
        data = json.loads(content.decode("utf-8-sig"))
        if isinstance(data, dict) and "items" in data:
            return data["items"]
        if not isinstance(data, list):
            raise ValueError("JSON должен содержать массив объектов")
        return data
    if lowered.endswith(".csv"):
        # По имени файла выбираем парсер инженеров или заявок.
        if "engineer" in lowered or "инжен" in lowered:
            return scenario_service.parse_engineers_csv(content)
        return scenario_service.parse_requests_csv(content)
    raise ValueError(f"Неподдерживаемый формат файла: {filename}")


@router.get(
    "/scenarios",
    response_model=ScenarioListResponse,
    summary="Список сохранённых сценариев",
)
def list_scenarios(
    region_id: str | None = Query(None, description="Фильтр по региону"),
    date: str | None = Query(None, description="Фильтр по дате YYYY-MM-DD"),
    source: str | None = Query(None, description="Фильтр по источнику: csv|booking|demo|json"),
    limit: int = 50,
    repository: Repository = Depends(get_repository),
) -> ScenarioListResponse:
    """Возвращает последние загруженные сценарии (с фильтрами)."""
    scenarios = repository.find_scenarios(
        region_id=region_id, date=date, source=source, limit=limit
    )
    items = [scenario_service.build_summary(scenario) for scenario in scenarios]
    return ScenarioListResponse(count=len(items), items=items)


@router.get(
    "/scenarios/{scenario_id}",
    response_model=ScenarioOut,
    summary="Получить сценарий по ID",
    response_description="Инженеры и заявки сценария.",
    responses=error_responses("not_found"),
)
def get_scenario(
    scenario_id: str,
    repository: Repository = Depends(get_repository),
) -> ScenarioOut:
    """Возвращает инженеров и заявки сохранённого сценария."""
    scenario = repository.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    return scenario_service.build_scenario_out(scenario)


@router.get(
    "/latest",
    response_model=ScenarioOut,
    summary="Получить последний загруженный сценарий",
    response_description="Самый свежий сценарий.",
    responses=error_responses("not_found"),
)
def get_latest_scenario(
    repository: Repository = Depends(get_repository),
) -> ScenarioOut:
    """Возвращает самый свежий сценарий."""
    scenarios = repository.list_scenarios(limit=1)
    if not scenarios:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарии не найдены")
    return scenario_service.build_scenario_out(scenarios[0])


@router.delete(
    "/scenarios",
    response_model=MessageResponse,
    summary="Удалить все сценарии",
    response_description="Сообщение с числом удалённых сценариев.",
    description="Удаляет все сценарии вместе со связанными планами и событиями.",
)
def delete_all_scenarios(
    repository: Repository = Depends(get_repository),
) -> MessageResponse:
    """Полностью очищает сценарии, планы и события."""
    count = repository.delete_all_scenarios()
    return MessageResponse(message=f"Удалено сценариев: {count} (вместе с планами и событиями)")


@router.delete(
    "/scenarios/{scenario_id}",
    response_model=MessageResponse,
    summary="Удалить сценарий",
    response_description="Сообщение об удалении сценария.",
    responses=error_responses("not_found"),
    description="Удаляет сценарий вместе со связанными планами и событиями.",
)
def delete_scenario(
    scenario_id: str,
    repository: Repository = Depends(get_repository),
) -> MessageResponse:
    """Удаляет сценарий по ID."""
    if not repository.delete_scenario(scenario_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    return MessageResponse(message=f"Сценарий {scenario_id} удалён")


# --- Инженеры сценария и часы симуляции ------------------------------------
class EngineerCreate(BaseModel):
    """Новый инженер дня (BPMN «меняет состав»)."""

    name: str
    skills: list[str] = Field(..., min_length=1, max_length=3)
    transport: str
    shift_start: str = "10:00"
    shift_end: str = "22:00"
    start: dict | str = "office"
    latitude: float | None = None
    longitude: float | None = None


class EngineerPatch(BaseModel):
    """Правка инженера до публикации плана."""

    transport: str | None = None
    shift_start: str | None = None
    shift_end: str | None = None
    skills: list[str] | None = None
    available: bool | None = None


class ClockIn(BaseModel):
    """Часы дня (D-24)."""

    time: str | None = Field(None, description="Время дня HH:MM или null (реальное время)")
    autoplay: bool = Field(True, description="Прогнать визиты плана до этого времени")


@router.get(
    "/scenarios/{scenario_id}/engineers",
    response_model=list,
    summary="Ростер инженеров дня",
)
def list_scenario_engineers(
    scenario_id: str,
    repository: Repository = Depends(get_repository),
) -> list:
    """Возвращает инженеров сценария."""
    scenario = repository.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    from app.schemas.engineer import EngineerOut

    return [EngineerOut.from_raw(item) for item in scenario.engineers]


@router.post(
    "/scenarios/{scenario_id}/engineers",
    response_model=ScenarioSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить инженеров в день",
)
def add_scenario_engineers(
    scenario_id: str,
    payload: list[EngineerCreate],
    repository: Repository = Depends(get_repository),
) -> ScenarioSummary:
    """Добавляет одного или нескольких инженеров до публикации плана."""
    scenario = repository.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    if (scenario.scenario_metadata or {}).get("active_plan_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="План опубликован: изменение состава — через событие engineer_available/extend-resource",
        )
    office = (scenario.scenario_metadata or {}).get("office") or {"lat": 55.75, "lon": 37.62}
    engineers = list(scenario.engineers)
    for index, item in enumerate(payload):
        engineer_id = f"E{len(engineers) + index + 1:02d}"
        lat = item.latitude if item.latitude is not None else office.get("lat", 55.75)
        lon = item.longitude if item.longitude is not None else office.get("lon", 37.62)
        engineers.append(
            EngineerIn(
                id=engineer_id,
                name=item.name,
                latitude=lat,
                longitude=lon,
                shift_start=item.shift_start,
                shift_end=item.shift_end,
                skills=item.skills,
                transport=item.transport,
                available=True,
                start_kind="office" if item.start == "office" else "home",
            ).model_dump()
        )
    scenario.engineers = engineers
    repository.update_scenario(scenario)
    _publish_roster_changed(scenario)
    return scenario_service.build_summary(scenario)


@router.patch(
    "/scenarios/{scenario_id}/engineers/{engineer_id}",
    response_model=ScenarioSummary,
    summary="Изменить инженера до публикации плана",
)
def patch_scenario_engineer(
    scenario_id: str,
    engineer_id: str,
    payload: EngineerPatch,
    repository: Repository = Depends(get_repository),
) -> ScenarioSummary:
    """Правит инженера (транспорт/смена/навыки/доступность) до публикации."""
    scenario = repository.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    if (scenario.scenario_metadata or {}).get("active_plan_id"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="План опубликован: используйте события transport_changed/engineer_unavailable",
        )
    engineers = list(scenario.engineers)
    found = False
    for engineer in engineers:
        if engineer["id"] != engineer_id:
            continue
        found = True
        for field in ("transport", "shift_start", "shift_end", "skills", "available"):
            value = getattr(payload, field)
            if value is not None:
                engineer[field] = value
    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Инженер не найден")
    scenario.engineers = engineers
    repository.update_scenario(scenario)
    _publish_roster_changed(scenario)
    return scenario_service.build_summary(scenario)



# --- Часы дня (D-24) --------------------------------------------------------
@router.get(
    "/scenarios/{scenario_id}/clock",
    summary="Часы дня",
    description="Возвращает часы сценария (HH:MM) или null (реальное время Europe/Moscow).",
)
def get_clock(
    scenario_id: str,
    repository: Repository = Depends(get_repository),
) -> dict:
    """Часы сценария и реальное время."""
    from app.core.timeutils import now_hhmm
    from app.services.day_clock import scenario_clock

    scenario = repository.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    return {"scenario_id": scenario_id, "clock": scenario_clock(scenario), "real_now": now_hhmm()}


@router.post(
    "/scenarios/{scenario_id}/clock",
    summary="Установить часы дня",
    description=(
        "Ставит часы сценария (HH:MM) или возвращает реальное время (null). "
        "Вперёд с автопрогоном визиты плана становятся фактами."
    ),
    responses=error_responses("not_found", "validation"),
)
def set_clock(
    scenario_id: str,
    payload: ClockIn,
    repository: Repository = Depends(get_repository),
) -> dict:
    """Задаёт часы дня и прогоняет визиты до этого времени."""
    from app.schemas.validators import time_to_minutes, validate_time_string
    from app.services.day_clock import autoplay, scenario_clock

    scenario = repository.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
    if payload.time is not None:
        validate_time_string(payload.time)
        current = scenario_clock(scenario)
        if current and time_to_minutes(payload.time) < time_to_minutes(current):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "CLOCK_BACKWARD",
                        "message": "Часы назад не переводятся",
                    }
                },
            )
    metadata = dict(scenario.scenario_metadata or {})
    metadata["clock"] = payload.time
    scenario.scenario_metadata = metadata
    repository.update_scenario(scenario)

    autoplayed = {"done": 0, "in_progress": 0, "en_route": 0, "total": 0}
    if payload.time is not None and payload.autoplay:
        autoplayed = autoplay(repository, scenario, payload.time)
    # Живое обновление часов дня (§38).
    try:
        from app.realtime.hub import hub

        meta = scenario.scenario_metadata or {}
        hub.publish(
            "clock.changed",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={"clock": payload.time, "autoplayed": autoplayed},
        )
    except Exception:  # noqa: BLE001
        pass
    return {"scenario_id": scenario_id, "clock": payload.time, "autoplayed": autoplayed}
