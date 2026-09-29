"""Сервис объяснения решений на понятном диспетчеру языке.

Объяснения формируются детерминированно по отчёту алгоритма, без LLM. Для
назначенных заявок перечисляются проверенные ограничения (навык, транспорт,
время) и факторы маршрута. Для неназначенных — явная причина из справочника
кодов алгоритма.
"""
from __future__ import annotations

from typing import Any

from app.core.constants import skill_display, transport_display
from app.schemas.plan import ExplanationOut, UnassignedOut
from app.services.algorithm_adapter import AdaptedProblem, AlgorithmAdapter, AlgorithmExecutionError
from app.services.route_service import report_to_index_routes

# Понятные формулировки причин неназначения по кодам алгоритма.
UNASSIGNED_REASON_TEXT: dict[str, str] = {
    "NO_SKILL": "Нет инженера с требуемым навыком «{skill}».",
    "NO_SKILL_LEVEL": "Нет инженера с требуемым уровнем квалификации по навыку «{skill}».",
    "NO_TRANSPORT": "Нужен другой тип транспорта, у подходящих по навыку исполнителей его нет.",
    "NO_EQUIPMENT": "Нет инженера с требуемым оборудованием (комплектом инструментов).",
    "NO_COMPATIBLE_RESOURCE": (
        "Нет доступного инженера с требуемым типом транспорта или оборудованием."
    ),
    "NO_CAPACITY": (
        "Нет свободных исполнителей на требуемое время: подходящие инженеры заняты в этом окне."
    ),
    "NO_DIRECT_FEASIBLE_SLOT": (
        "Работа не помещается во временное окно и смену ни у одного подходящего инженера."
    ),
    "NOT_PLANNED_IN_SEARCH_BUDGET": (
        "Заявка не вошла в найденный план при заданных приоритетах и бюджете поиска."
    ),
    "DISPATCHER_NOT_ASSIGNED": "В реальном распределении бригада не назначена.",
    "MANUAL_UNASSIGNED": "Не назначена после ручного переназначения.",
    "DISPLACED_BY_URGENT": "Вытеснена срочной заявкой и не поместилась к другим исполнителям.",
    "ENGINEER_UNAVAILABLE": "Исполнитель стал недоступен, заявку не удалось передать другим.",
}


def _unassigned_reason(code: str, fallback: str, skill: str | None) -> str:
    """Возвращает понятную причину неназначения по коду алгоритма."""
    template = UNASSIGNED_REASON_TEXT.get(code)
    if template is None:
        return fallback or "Заявка не назначена."
    return template.format(skill=skill_display(skill) if skill else "—")


def build_unassigned(problem: AdaptedProblem, report: dict[str, Any]) -> list[UnassignedOut]:
    """Формирует список неназначенных заявок с обязательными причинами."""
    request_by_id = problem.request_by_id
    result: list[UnassignedOut] = []
    for entry in report.get("unassigned", []):
        task_id = entry["task_id"]
        request = request_by_id.get(task_id, {})
        code = entry.get("code", "UNKNOWN")
        if code == "NO_COMPATIBLE_RESOURCE":
            if _equipment_is_the_cause(problem, request):
                code = "NO_EQUIPMENT"
            elif _transport_is_the_cause(problem, request):
                code = "NO_TRANSPORT"
        elif code == "NOT_PLANNED_IN_SEARCH_BUDGET":
            code = "NO_CAPACITY"
        result.append(
            UnassignedOut(
                request_id=task_id,
                reason_code=code,
                reason=_unassigned_reason(code, entry.get("text", ""), request.get("required_skill")),
                proven_static=bool(entry.get("proven_static", False)),
            )
        )
    return result


def _equipment_is_the_cause(problem: AdaptedProblem, request: dict) -> bool:
    """Проверяет, что причина неназначения — именно отсутствие оборудования."""
    required = set(request.get("required_tools", ()) or ())
    if not required:
        return False
    for engineer in problem.engineers:
        if request.get("required_skill") not in engineer.get("skills", []):
            continue
        required_transport = request.get("required_transport")
        if required_transport and required_transport != engineer.get("transport"):
            continue
        have = {key for key, value in (engineer.get("kit") or {}).items() if int(value) > 0}
        if not required.issubset(have):
            return True
    return False


def _transport_is_the_cause(problem: AdaptedProblem, request: dict) -> bool:
    """Проверяет, что причина неназначения — отсутствие нужного транспорта."""
    required_transport = request.get("required_transport")
    if not required_transport:
        return False
    for engineer in problem.engineers:
        if request.get("required_skill") not in engineer.get("skills", []):
            continue
        if engineer.get("transport") == required_transport:
            return False
    # есть инженеры с навыком, но ни у одного нет нужного транспорта
    return any(
        request.get("required_skill") in engineer.get("skills", [])
        for engineer in problem.engineers
    )


def _assignment_reasons(
    problem: AdaptedProblem,
    request: dict[str, Any],
    engineer: dict[str, Any],
    row: dict[str, Any],
    sequence: int,
    route_distance_km: float,
) -> list[str]:
    """Собирает список факторов, повлиявших на назначение заявки."""
    reasons = [f"Инженер владеет требуемым навыком «{skill_display(request['required_skill'])}»."]

    required_transport = request.get("required_transport")
    if required_transport:
        if required_transport == engineer["transport"]:
            reasons.append(
                f"Доступен требуемый транспорт — {transport_display(required_transport)}."
            )
        else:
            reasons.append(
                "Требование по транспорту выполнено: "
                f"{transport_display(engineer['transport'])}."
            )
    else:
        reasons.append("Ограничение по типу транспорта для заявки не задано.")

    reasons.append(
        f"Начало работ {row['start']} попадает во временное окно "
        f"{request['window_start']}–{request['window_end']}."
    )
    reasons.append(
        f"Маршрут завершается в {row['end']}, до конца смены {engineer['shift_end']}."
    )
    reasons.append(
        f"Заявка стоит {sequence}-й в маршруте; суммарный пробег маршрута "
        f"{round(route_distance_km, 2)} км."
    )
    if request.get("priority") == "urgent":
        reasons.append("Заявка срочная и обработана с более высоким приоритетом.")
    return reasons


def build_explanations(
    adapter: AlgorithmAdapter, problem: AdaptedProblem, report: dict[str, Any]
) -> list[ExplanationOut]:
    """Формирует объяснения по всем заявкам плана."""
    explanations: list[ExplanationOut] = []
    request_by_id = problem.request_by_id
    routes = report_to_index_routes(problem, report)

    for entry in report.get("routes", []):
        engineer_id = entry["engineer_id"]
        engineer = problem.engineer_by_id[engineer_id]
        distance_km = float(entry.get("distance_km", 0.0))
        for sequence, row in enumerate(entry.get("schedule", []), start=1):
            request = request_by_id[row["task_id"]]
            reasons = _assignment_reasons(problem, request, engineer, row, sequence, distance_km)
            summary = (
                f"Заявка №{request['id']} назначена инженеру {engineer.get('name', engineer_id)} "
                f"({engineer_id}). Все обязательные ограничения выполнены."
            )
            local_alternatives: list[dict[str, Any]] = []
            try:
                detail = adapter.explain_task(problem, routes, request["id"])
                local_alternatives = detail.get("local_alternatives", [])
            except AlgorithmExecutionError:
                # Объяснение не должно ломать основной ответ.
                local_alternatives = []
            explanations.append(
                ExplanationOut(
                    request_id=request["id"],
                    status="assigned",
                    engineer_id=engineer_id,
                    engineer_name=engineer.get("name", engineer_id),
                    summary=summary,
                    reasons=reasons,
                    schedule=row,
                    local_alternatives=local_alternatives,
                )
            )

    for entry in report.get("unassigned", []):
        request = request_by_id.get(entry["task_id"], {})
        code = entry.get("code", "UNKNOWN")
        explanations.append(
            ExplanationOut(
                request_id=entry["task_id"],
                status="unassigned",
                engineer_id=None,
                engineer_name=None,
                summary=(
                    f"Заявка №{entry['task_id']} не назначена. "
                    f"Причина: {_unassigned_reason(code, entry.get('text', ''), request.get('required_skill'))}"
                ),
                reasons=[
                    _unassigned_reason(code, entry.get("text", ""), request.get("required_skill"))
                ],
                schedule=None,
                local_alternatives=[],
            )
        )

    return explanations
