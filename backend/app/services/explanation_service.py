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
from app.schemas.validators import time_to_minutes
from app.services.algorithm_adapter import AdaptedProblem, AlgorithmAdapter, AlgorithmExecutionError
from app.services.route_service import report_to_index_routes

# Понятные формулировки причин неназначения по кодам алгоритма.
#: Причина «нет места в найденном плане». Алгоритм не доказывает, что подходящих
#: инженеров нет вообще, поэтому формулировка честно ограничена найденным планом.
CAPACITY_REASON = (
    "Подходящие инженеры есть, но свободного исполнителя в найденном плане нет."
)

UNASSIGNED_REASON_TEXT: dict[str, str] = {
    "NO_SKILL": "Нет инженера с требуемым навыком «{skill}».",
    "NO_SKILL_LEVEL": "Нет инженера с требуемым уровнем квалификации по навыку «{skill}».",
    "NO_TRANSPORT": "Нужен другой тип транспорта, у подходящих по навыку исполнителей его нет.",
    "NO_EQUIPMENT": "Нет инженера с требуемым оборудованием (комплектом инструментов).",
    "NO_COMPATIBLE_RESOURCE": (
        "Нет доступного инженера с требуемым типом транспорта или оборудованием."
    ),
    "NO_CAPACITY": CAPACITY_REASON,
    "NO_DIRECT_FEASIBLE_SLOT": (
        "Работа не помещается во временное окно и смену ни у одного подходящего инженера."
    ),
    # Устаревший код прежнего контракта: причина та же, что у NO_CAPACITY.
    "NOT_PLANNED_IN_SEARCH_BUDGET": CAPACITY_REASON,
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


def _resolve_unassigned(problem: AdaptedProblem, entry: dict[str, Any]) -> tuple[str, str]:
    """Единая причина неназначения: код и текст для всех экранов.

    Приводит устаревшие/составные коды к каноническим и возвращает один и тот же
    текст, который попадает и в список ``unassigned``, и в ``explanations``.
    """
    request = problem.request_by_id.get(entry["task_id"], {})
    code = entry.get("code", "UNKNOWN")
    if code == "NO_COMPATIBLE_RESOURCE":
        if _equipment_is_the_cause(problem, request):
            code = "NO_EQUIPMENT"
        elif _transport_is_the_cause(problem, request):
            code = "NO_TRANSPORT"
    elif code == "NOT_PLANNED_IN_SEARCH_BUDGET":
        code = "NO_CAPACITY"
    reason = _unassigned_reason(code, entry.get("text", ""), request.get("required_skill"))
    return code, reason


def build_unassigned(problem: AdaptedProblem, report: dict[str, Any]) -> list[UnassignedOut]:
    """Формирует список неназначенных заявок с обязательными причинами."""
    result: list[UnassignedOut] = []
    for entry in report.get("unassigned", []):
        code, reason = _resolve_unassigned(problem, entry)
        result.append(
            UnassignedOut(
                request_id=entry["task_id"],
                reason_code=code,
                reason=reason,
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
    local_alternatives: list[dict[str, Any]] | None = None,
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
    # Почему именно этот порядок: конкретные времена визита.
    reasons.append(
        f"Порядок в маршруте: визит {sequence}-й — приезд {row.get('arrival')}, "
        f"начало {row['start']}, запас до конца окна "
        f"{row.get('window_slack_minutes', '—')} мин."
    )
    reasons.append(
        f"Заявка стоит {sequence}-й в маршруте; суммарный пробег маршрута "
        f"{round(route_distance_km, 2)} км."
    )
    if request.get("priority") == "urgent":
        reasons.append("Заявка срочная и обработана с более высоким приоритетом.")

    reasons.append(_alternative_note(problem, local_alternatives or []))
    return reasons


def _alternative_note(problem: AdaptedProblem, alternatives: list[dict[str, Any]]) -> str:
    """Конкретная альтернатива назначению: время и пробег при другом допустимом выборе."""
    if not alternatives:
        return "Других допустимых назначений этой заявки в найденном плане нет."
    best = min(alternatives, key=lambda item: tuple(item.get("objective") or [0] * 6))
    engineer_id = best.get("engineer_id")
    engineer = problem.engineer_by_id.get(engineer_id, {})
    name = engineer.get("name", engineer_id)
    delta_km = float(best.get("delta_distance_km") or 0.0)
    if delta_km > 1e-9:
        km_text = f"пробег плана вырос бы на {delta_km:.1f} км"
    elif delta_km < -1e-9:
        km_text = f"пробег плана сократился бы на {abs(delta_km):.1f} км"
    else:
        km_text = "пробег плана не изменился бы"
    delta_start = best.get("delta_start_min")
    start = best.get("start")
    if start:
        shift = int(delta_start) if isinstance(delta_start, (int, float)) else 0
        sign = "+" if shift > 0 else ""
        time_text = f"начало в {start} ({sign}{shift} мин к выбранному)"
    else:
        time_text = "время начала не изменилось бы"
    return (
        f"Альтернатива — инженер {name} ({engineer_id}): {time_text}; {km_text}. "
        f"Выбранный вариант по приоритету не хуже."
    )


def _enrich_alternatives(
    adapter: AlgorithmAdapter,
    problem: AdaptedProblem,
    routes: list[tuple[int, ...]],
    request_id: str,
    alternatives: list[dict[str, Any]],
    chosen_row: dict[str, Any],
) -> None:
    """Дополняет альтернативы началом визита и сдвигом времени (для объяснения).

    Использует существующие маршруты плана: заявку переносим к другому инженеру
    на найденную позицию и считаем расписание. Ошибки не ломают ответ.
    """
    if not alternatives:
        return
    try:
        ev = adapter.evaluator(problem)
        index = {task.id: i for i, task in enumerate(problem.instance.tasks)}
        task_index = index[request_id]
        chosen_start = time_to_minutes(chosen_row["start"]) if chosen_row.get("start") else None
        for alternative in alternatives:
            owner = next((k for k, r in enumerate(routes) if task_index in r), None)
            target = next(
                (
                    k
                    for k, e in enumerate(problem.instance.engineers)
                    if e.id == alternative.get("engineer_id")
                ),
                None,
            )
            if owner is None or target is None:
                continue
            reduced = tuple(i for i in routes[owner] if i != task_index)
            position = int(alternative.get("position") or 0)
            candidate_target = routes[target][:position] + (task_index,) + routes[target][position:]
            schedule = ev.schedule(target, candidate_target)
            row = next((r for r in schedule if r["task_id"] == request_id), None)
            if row is None:
                continue
            alternative["arrival"] = row.get("arrival")
            alternative["start"] = row.get("start")
            if chosen_start is not None and row.get("start"):
                alternative["delta_start_min"] = time_to_minutes(row["start"]) - chosen_start
    except Exception:  # noqa: BLE001 — объяснение не должно ломать план
        return


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
            local_alternatives: list[dict[str, Any]] = []
            try:
                detail = adapter.explain_task(problem, routes, request["id"])
                local_alternatives = detail.get("local_alternatives", [])
                _enrich_alternatives(
                    adapter, problem, routes, request["id"], local_alternatives, row
                )
            except AlgorithmExecutionError:
                # Объяснение не должно ломать основной ответ.
                local_alternatives = []
            reasons = _assignment_reasons(
                problem, request, engineer, row, sequence, distance_km, local_alternatives
            )
            summary = (
                f"Заявка №{request['id']} назначена инженеру "
                f"{engineer.get('name', engineer_id)} ({engineer_id}): навык и транспорт "
                f"подходят, начало {row['start']} в окне {request['window_start']}–"
                f"{request['window_end']}, визит {sequence}-й в маршруте."
            )
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
        code, reason = _resolve_unassigned(problem, entry)
        explanations.append(
            ExplanationOut(
                request_id=entry["task_id"],
                status="unassigned",
                engineer_id=None,
                engineer_name=None,
                summary=f"Заявка №{entry['task_id']} не назначена. Причина: {reason}",
                reasons=[reason],
                schedule=None,
                local_alternatives=[],
            )
        )

    return explanations
