"""Справочник участков: три участка кейса и свои участки (§14)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Security, status

from app.api.deps import get_app_settings, get_current_user, get_repository, require_roles, verify_token
from app.core.config import Settings
from app.core.constants import SKILL_ALIASES
from app.core.regions import build_region_roster, get_region, is_builtin, list_regions
from app.schemas.engineer import EngineerIn
from app.schemas.extras import RegionCreate, RegionNorms, RegionOut, RegionPatch
from app.storage.models import RegionRecord
from app.storage.repository import Repository

router = APIRouter(tags=["Служебные"], dependencies=[Security(verify_token)])


def _error(code: int, error: str, message: str, details: dict | None = None) -> HTTPException:
    return HTTPException(
        status_code=code,
        detail={"error": {"code": error, "message": message, "details": details or {}}},
    )


def _name_key(name: str) -> str:
    return " ".join(name.split()).lower().replace("ё", "е")


def _norms(norms: RegionNorms | None) -> dict:
    """Нормативы с каноническими навыками; незнакомый навык — 422."""
    if norms is None:
        return {"types": []}
    types, seen = [], set()
    for item in norms.types:
        skill = SKILL_ALIASES.get(item.skill.strip().lower())
        if skill is None:
            raise _error(422, "VALIDATION_ERROR", f"Незнакомый навык: {item.skill}")
        key = _name_key(item.type_bk)
        if key in seen:
            raise _error(422, "VALIDATION_ERROR", f"Тип заявки повторяется: {item.type_bk}")
        seen.add(key)
        types.append({"type_bk": item.type_bk.strip(), "skill": skill, "duration_minutes": item.duration_minutes})
    return {"types": types}


def _check_name(repository: Repository, name: str, region_id: str | None = None) -> None:
    key = _name_key(name)
    taken = next((r for r in list_regions(repository) if _name_key(r["name"]) == key), None)
    if taken is not None and taken["region_id"] != region_id:
        raise _error(409, "REGION_EXISTS", f"Участок «{taken['name']}» уже есть", {"region_id": taken["region_id"]})


def _custom_record(repository: Repository, region_id: str) -> RegionRecord:
    if is_builtin(region_id):
        raise _error(409, "REGION_BUILTIN", "Участки кейса не меняются")
    record = repository.get_region_record(region_id)
    if record is None:
        raise _error(404, "REGION_NOT_FOUND", f"Нет участка {region_id}")
    return record


@router.get(
    "/regions",
    response_model=list[RegionOut],
    summary="Список участков",
    description="Три участка кейса, затем свои участки (§14) в порядке создания.",
)
def get_regions(repository: Repository = Depends(get_repository)) -> list[RegionOut]:
    return [RegionOut(**region) for region in list_regions(repository)]


@router.post(
    "/regions",
    response_model=RegionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Создать участок (§14)",
    dependencies=[Depends(require_roles("dispatcher"))],
)
def create_region(
    payload: RegionCreate,
    repository: Repository = Depends(get_repository),
    user=Depends(get_current_user),
) -> RegionOut:
    name = " ".join(payload.name.split())
    _check_name(repository, name)
    record = RegionRecord(
        id=f"r-{uuid.uuid4().hex[:8]}",
        name=name,
        name_key=_name_key(name),
        office_address=payload.office.address.strip(),
        office_lat=payload.office.lat,
        office_lon=payload.office.lon,
        norms=_norms(payload.norms),
        roster=[],
        created_by=getattr(user, "id", None),
    )
    repository.save_region_record(record)
    return RegionOut(**get_region(record.id, repository))


@router.patch(
    "/regions/{region_id}",
    response_model=RegionOut,
    summary="Изменить свой участок (§14)",
    dependencies=[Depends(require_roles("dispatcher"))],
)
def patch_region(
    region_id: str, payload: RegionPatch, repository: Repository = Depends(get_repository)
) -> RegionOut:
    record = _custom_record(repository, region_id)
    if payload.name is not None:
        name = " ".join(payload.name.split())
        _check_name(repository, name, region_id)
        record.name, record.name_key = name, _name_key(name)
    if payload.office is not None:
        record.office_address = payload.office.address.strip()
        record.office_lat, record.office_lon = payload.office.lat, payload.office.lon
    if payload.norms is not None:
        record.norms = _norms(payload.norms)
    repository.save_region_record(record)
    return RegionOut(**get_region(region_id, repository))


@router.get(
    "/regions/{region_id}/roster",
    response_model=list[EngineerIn],
    summary="Ростер участка (§14)",
)
def get_roster(region_id: str, repository: Repository = Depends(get_repository)) -> list[EngineerIn]:
    region = get_region(region_id, repository)
    if region is None:
        raise _error(404, "REGION_NOT_FOUND", f"Нет участка {region_id}")
    return [EngineerIn(**item) for item in build_region_roster(region)]


@router.put(
    "/regions/{region_id}/roster",
    response_model=list[EngineerIn],
    summary="Сохранить ростер своего участка (§14)",
    dependencies=[Depends(require_roles("dispatcher"))],
)
def put_roster(
    region_id: str,
    roster: list[EngineerIn],
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_app_settings),
) -> list[EngineerIn]:
    record = _custom_record(repository, region_id)
    if not roster:
        raise _error(422, "VALIDATION_ERROR", "Нужна хотя бы одна бригада")
    if len(roster) > settings.max_engineers:
        raise _error(422, "VALIDATION_ERROR", f"Не больше {settings.max_engineers} бригад")
    ids = [item.id for item in roster]
    if len(set(ids)) != len(ids):
        raise _error(422, "VALIDATION_ERROR", "id бригад повторяются")
    record.roster = [item.model_dump() for item in roster]
    repository.save_region_record(record)
    # Живое обновление: состав бригад изменился (§38).
    try:
        from app.realtime.hub import hub

        hub.publish(
            "roster.changed",
            region_id=region_id,
            data={"region_id": region_id, "engineer_count": len(roster)},
        )
    except Exception:  # noqa: BLE001
        pass
    return roster
