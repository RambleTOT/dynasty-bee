"""Движок перепланирования: единая обработка событий S0–S14.

Слой не меняет алгоритм: он применяет событие к снимку входных данных,
замораживает прошлое (rolling horizon через ``dispatch.replan``) и собирает
новый план. Для точечных операций (ручное переназначение, подсказки) напрямую
используется ``Evaluator`` алгоритма.
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from app.core.constants import normalize_transport, skill_display, transport_display
from app.schemas.event import EVENT_ALIASES, ApplyEventRequest
from app.schemas.validators import minutes_to_time, safe_time_to_minutes, time_to_minutes
from app.services.algorithm_adapter import AdaptedProblem, AlgorithmAdapter, AlgorithmExecutionError
from app.services.metrics_service import metric_block_from_report
from app.services.planner_service import PlannerService
from app.services.route_service import report_to_index_routes

logger = logging.getLogger(__name__)

#: Типы, при которых текущий визит/работа замораживается.
_FREEZE_TYPES = {
    "urgent_order_added",
    "order_cancelled",
    "engineer_unavailable",
    "order_added",
    "engineer_delayed",
    "finished_early",
    "transport_changed",
    "order_window_changed",
    "engineer_available",
    "order_scope_changed",
}

#: Типы, требующие добора ресурса/песочницы (обрабатываются отдельно).
_SPECIAL_TYPES = {"manual_reassign", "extend_resource", "shift_windows"}


def canonical_type(event_type: str) -> str:
    """Приводит старые имена событий к каноническим."""
    return EVENT_ALIASES.get(event_type, event_type)


def _next_engineer_id(engineers: list[dict[str, Any]]) -> str:
    """Свободный id бригады вида ``E07`` для добавления в начатый день."""
    used = {str(item.get("id", "")) for item in engineers}
    index = len(engineers) + 1
    while f"E{index:02d}" in used:
        index += 1
    return f"E{index:02d}"


def _default_start_coords(engineers: list[dict[str, Any]]) -> tuple[float, float]:
    """Стартовая точка новой бригады — офисный кластер существующих."""
    offices = [e for e in engineers if e.get("start_kind", "office") == "office"]
    pool = offices or engineers
    if not pool:
        return 55.75, 37.62
    lat = sum(float(item["latitude"]) for item in pool) / len(pool)
    lon = sum(float(item["longitude"]) for item in pool) / len(pool)
    return round(lat, 6), round(lon, 6)


def report_allow_violations(
    problem: AdaptedProblem, routes: list[tuple[int, ...]]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Строит отчёт, допуская опоздания (для force-переназначений и сравнения).

    Возвращает ``(report, violations)``. Используется, когда строгий Evaluator
    считает маршрут недопустимым: метрики и расписание всё равно нужны.
    """
    violations: list[dict[str, Any]] = []
    report_routes = []
    assigned = set()
    total_distance_m = 0
    active = 0
    for k, route in enumerate(routes):
        engineer = problem.instance.engineers[k]
        travel = problem.instance.travel_minutes[engineer.transport]
        distance = problem.instance.distance_m[engineer.transport]
        now, prev = engineer.shift_start, engineer.start_node
        schedule = []
        for i in route:
            task = problem.instance.tasks[i]
            leg = int(travel[prev, task.node])
            arrival = now + leg
            start = max(arrival, task.window_start, task.release_time)
            end = start + task.duration
            if start > task.window_end:
                violations.append(
                    {
                        "task_id": task.id,
                        "engineer_id": engineer.id,
                        "kind": "WINDOW_LATE",
                        "late_min": start - task.window_end,
                        "manual_override": True,
                    }
                )
            schedule.append(
                {
                    "task_id": task.id,
                    "arrival_minute": arrival,
                    "start_minute": start,
                    "end_minute": end,
                    "arrival": minutes_to_time(arrival),
                    "start": minutes_to_time(start),
                    "end": minutes_to_time(end),
                    "waiting_minutes": start - arrival,
                    "travel_minutes": leg,
                    "leg_metres": int(distance[prev, task.node]),
                    "window_slack_minutes": task.window_end - start,
                }
            )
            total_distance_m += int(distance[prev, task.node])
            assigned.add(i)
            now, prev = end, task.node
        if route:
            active += 1
        report_routes.append(
            {
                "engineer_id": engineer.id,
                "task_ids": [problem.instance.tasks[i].id for i in route],
                "distance_km": sum(r["leg_metres"] for r in schedule) / 1000,
                "schedule": schedule,
                "explanation": "План с допущенными нарушениями окна.",
            }
        )
    unassigned = []
    for i, task in enumerate(problem.instance.tasks):
        if i not in assigned:
            unassigned.append(
                {
                    "task_id": task.id,
                    "request_id": task.id,
                    "code": "MANUAL_UNASSIGNED",
                    "reason_code": "MANUAL_UNASSIGNED",
                    "reason": "Не назначена после ручного переназначения.",
                    "text": "Не назначена после ручного переназначения.",
                    "proven_static": False,
                }
            )
    report = {
        "objective": [0, len(unassigned), active, total_distance_m],
        "unassigned_urgent": 0,
        "unassigned_count": len(unassigned),
        "planned_count": len(problem.instance.tasks) - len(unassigned),
        "active_engineers_today": active,
        "future_distance_km": total_distance_m / 1000,
        "routes": report_routes,
        "unassigned": unassigned,
        "metadata": {},
    }
    return report, violations


@dataclass
class EventComputation:
    """Результат применения события (до сохранения в БД)."""

    problem: AdaptedProblem
    report: dict[str, Any]
    api_result: dict[str, Any]
    changes: list[dict[str, Any]]
    scenario: dict[str, Any]
    applied_event: dict[str, Any]
    violations: list[dict[str, Any]] = field(default_factory=list)
    elapsed: float = 0.0
    engineers: list[dict[str, Any]] = field(default_factory=list)
    requests: list[dict[str, Any]] = field(default_factory=list)
    cancelled_ids: set[str] = field(default_factory=set)


class ReplanEngine:
    """Применение событий рабочего дня к сохранённому плану."""

    def __init__(self, adapter: AlgorithmAdapter, planner: PlannerService) -> None:
        self.adapter = adapter
        self.planner = planner

    # --- Публичный API -----------------------------------------------------
    def apply(self, plan, event, *, persist_changes: bool = True) -> EventComputation:
        """Применяет событие и возвращает новый расчёт плана."""
        base_report = (plan.algorithm_meta or {}).get("algorithm_report") or {}
        input_payload = plan.input_payload or {}
        engineers = copy.deepcopy(input_payload.get("engineers", []))
        requests = copy.deepcopy(input_payload.get("requests", []))
        # Отменённые и перенесённые записи не участвуют ни в одном расчёте (п. 39, 49).
        requests = [
            item for item in requests if item.get("status") not in {"cancelled", "rescheduled"}
        ]
        if not engineers or not requests:
            raise AlgorithmExecutionError("В исходном плане нет входных данных")

        event_time_str = event.event_time_value()
        event_time = time_to_minutes(event_time_str) if event_time_str else None
        canonical = canonical_type(event.type)

        applied, cancelled_ids, force_full = self._mutate(
            canonical, event, engineers, requests, event_time
        )

        started = perf_counter()
        problem = self.adapter.prepare_problem(engineers, requests)
        report_problem = problem

        if event_time is not None and base_report and canonical in _FREEZE_TYPES:
            minimal_cancel = (
                self._minimal_cancel_problem(engineers, requests, base_report, cancelled_ids)
                if canonical == "order_cancelled"
                else None
            )
            if minimal_cancel is not None:
                # Локальная починка отмены: убираем заявку, остальные не трогаем.
                report_problem, full_report = minimal_cancel
                raw_report = full_report
            else:
                states, completed_ids, frozen_entries, frozen_distance = self._execution_state(
                    problem, base_report, event_time, event.telemetry, engineers, cancelled_ids
                )
                inserted_report = None
                if canonical in {"urgent_order_added", "order_added"}:
                    try:
                        inserted_report = self._try_insert_new(
                            problem,
                            base_report,
                            frozen_entries,
                            applied.get("request_id"),
                            prefer_earliest=(canonical == "urgent_order_added"),
                        )
                    except (ValueError, AlgorithmExecutionError):
                        # Базовый план с допущенным нарушением: вставка не считается,
                        # идём через перепланирование остатка (п. 25).
                        inserted_report = None
                    # После события маршрут не может начинаться раньше event_time.
                    if inserted_report is not None and not self._insert_respects_event(
                        inserted_report, applied.get("request_id"), event_time
                    ):
                        inserted_report = None
                if inserted_report is not None:
                    # Минимальные изменения: новая заявка вставлена в существующий
                    # маршрут без переназначений; прошлое сохранено.
                    full_report = inserted_report
                    raw_report = inserted_report
                else:
                    try:
                        _, result = self.adapter.replan_residual(
                            problem,
                            base_report,
                            event_time,
                            states,
                            completed_ids,
                            cancelled_ids,
                            seed=event.seed if event.seed is not None else 42,
                            total_seconds=event.time_limit_seconds or 5.0,
                        )
                        full_report = self._merge(
                            base_report,
                            result.report,
                            problem,
                            frozen_entries,
                            frozen_distance,
                            cancelled_ids,
                        )
                        raw_report = result.report
                    except AlgorithmExecutionError:
                        # Заморозка невозможна (например, некорректная телеметрия) — полный пересчёт.
                        requests[:] = [r for r in requests if r["id"] not in cancelled_ids]
                        problem = self.adapter.prepare_problem(engineers, requests)
                        report_problem = problem
                        result = self.adapter.run(
                            problem,
                            solver=event.solver or "hybrid_v2",
                            seed=event.seed if event.seed is not None else 42,
                            total_seconds=event.time_limit_seconds or 5.0,
                        )
                        full_report = result.report
                        raw_report = result.report
        else:
            if canonical == "order_cancelled":
                requests[:] = [r for r in requests if r["id"] not in cancelled_ids]
                problem = self.adapter.prepare_problem(engineers, requests)
                report_problem = problem
            result = self.adapter.run(
                problem,
                solver=event.solver or "hybrid_v2",
                seed=event.seed if event.seed is not None else 42,
                total_seconds=event.time_limit_seconds or 5.0,
            )
            full_report = result.report
            raw_report = result.report
        elapsed = perf_counter() - started

        api_result = self.planner.build_api_result(report_problem, full_report, elapsed)
        changes = (
            self.adapter.plan_changes(base_report, raw_report)
            if base_report and persist_changes
            else []
        )
        api_result["changes"] = changes
        self._mark_cancelled(api_result, cancelled_ids)
        violations = self._collect_violations(report_problem, full_report)

        scenario = self._scenario_block(
            canonical, event, problem, api_result, base_report, event_time, applied
        )
        return EventComputation(
            problem=report_problem,
            report=full_report,
            api_result=api_result,
            changes=changes,
            scenario=scenario,
            applied_event=applied,
            violations=violations,
            elapsed=elapsed,
            engineers=engineers,
            requests=requests,
            cancelled_ids=cancelled_ids,
        )

    # --- Изменение входных данных -----------------------------------------
    def _mutate(
        self,
        canonical: str,
        event,
        engineers: list[dict],
        requests: list[dict],
        event_time: int | None,
    ) -> tuple[dict[str, Any], set[str], bool]:
        """Применяет событие к снимку данных. Возвращает (applied, cancelled, full)."""
        applied: dict[str, Any] = {"type": canonical, "source": event.source}
        if event.event_time_value():
            applied["time"] = event.event_time_value()
        cancelled: set[str] = set()
        params = event.params or {}

        by_id = {r["id"]: r for r in requests}
        eng_by_id = {e["id"]: e for e in engineers}

        if canonical == "urgent_order_added":
            assert event.request is not None
            new_request = event.request.model_dump()
            new_request["priority"] = "urgent"
            if event_time is not None:
                new_request["release_time"] = event_time
                if not new_request.get("window_start"):
                    new_request["window_start"] = minutes_to_time(event_time)
            requests.append(new_request)
            applied["request_id"] = new_request["id"]
            applied["priority"] = "urgent"

        elif canonical == "order_added":
            assert event.request is not None
            new_request = event.request.model_dump()
            new_request["priority"] = new_request.get("priority") or "normal"
            requests.append(new_request)
            applied["request_id"] = new_request["id"]

        elif canonical == "order_cancelled":
            request = by_id.get(event.order_id_value() or "")
            if request is None:
                raise AlgorithmExecutionError(f"Заявка {event.order_id_value()} не найдена")
            cancelled.add(request["id"])
            request["status"] = "cancelled"
            request["_cancel_reason"] = params.get("reason")
            applied["request_id"] = request["id"]
            applied["reason"] = params.get("reason")
            applied["stage"] = params.get("stage")
            if params.get("previous_status"):
                applied["previous_status"] = params.get("previous_status")

        elif canonical == "engineer_unavailable":
            engineer = eng_by_id.get(event.engineer_id or "")
            if engineer is None:
                raise AlgorithmExecutionError(f"Инженер {event.engineer_id} не найден")
            finish_current = bool(params.get("finish_current", True))
            if not finish_current and event_time is not None:
                # Текущую не доделывает: отменяем ещё не начатые заявки.
                for request in requests:
                    if request.get("assigned_engineer") == engineer["id"]:
                        cancelled.add(request["id"])
            engineer["available"] = False
            if params.get("to"):
                engineer["available"] = True
                engineer["shift_start"] = str(params["to"])
            applied["engineer_id"] = engineer["id"]
            applied["reason"] = params.get("reason")

        elif canonical == "engineer_available":
            engineer = eng_by_id.get(event.engineer_id or "")
            if engineer is None:
                raise AlgorithmExecutionError(f"Инженер {event.engineer_id} не найден")
            engineer["available"] = True
            if params.get("from"):
                engineer["shift_start"] = str(params["from"])
            applied["engineer_id"] = engineer["id"]

        elif canonical == "engineer_added":
            extra = event.engineer or params.get("engineer") or {}
            if not isinstance(extra, dict) or not extra:
                raise AlgorithmExecutionError("Для engineer_added передайте поле engineer")
            new_id = str(extra.get("id") or _next_engineer_id(engineers))
            if new_id in eng_by_id:
                raise AlgorithmExecutionError(f"Инженер {new_id} уже есть в дне")
            latitude = extra.get("latitude")
            longitude = extra.get("longitude")
            if latitude is None or longitude is None:
                latitude, longitude = _default_start_coords(engineers)
            start = extra.get("start")
            if isinstance(start, dict):
                start_kind = str(start.get("kind", "office"))
            elif isinstance(start, str):
                start_kind = start
            else:
                start_kind = "office"
            engineers.append(
                {
                    "id": new_id,
                    "name": extra.get("name") or f"Бригада {new_id}",
                    "latitude": float(latitude),
                    "longitude": float(longitude),
                    "shift_start": extra.get("shift_start", "10:00"),
                    "shift_end": extra.get("shift_end", "22:00"),
                    "skills": extra.get("skills") or ["local"],
                    "transport": extra.get("transport", "car"),
                    "available": bool(extra.get("available", True)),
                    "kit": dict(extra.get("kit") or {}),
                    "skill_levels": dict(extra.get("skill_levels") or {}),
                    "start_kind": start_kind,
                }
            )
            applied["engineer_id"] = new_id
            applied["engineer_name"] = extra.get("name")

        elif canonical == "engineer_delayed":
            applied["engineer_id"] = event.engineer_id
            applied["delay_min"] = int(params.get("delay_min", 15))

        elif canonical == "finished_early":
            applied["engineer_id"] = event.engineer_id
            applied["actual_end"] = params.get("actual_end")

        elif canonical == "transport_changed":
            engineer = eng_by_id.get(event.engineer_id or "")
            if engineer is None:
                raise AlgorithmExecutionError(f"Инженер {event.engineer_id} не найден")
            engineer["transport"] = normalize_transport(str(params.get("transport")))
            applied["engineer_id"] = engineer["id"]
            applied["transport"] = engineer["transport"]

        elif canonical == "order_window_changed":
            request = by_id.get(event.order_id_value() or "")
            if request is None:
                raise AlgorithmExecutionError(f"Заявка {event.order_id_value()} не найдена")
            request["window_start"] = str(params["window_start"])
            request["window_end"] = str(params["window_end"])
            applied["request_id"] = request["id"]
            applied["window"] = [request["window_start"], request["window_end"]]

        elif canonical == "order_scope_changed":
            request = by_id.get(event.order_id_value() or "")
            if request is None:
                raise AlgorithmExecutionError(f"Заявка {event.order_id_value()} не найдена")
            if params.get("extra_min"):
                request["duration_minutes"] = int(request["duration_minutes"]) + int(
                    params["extra_min"]
                )
            if params.get("required_skill"):
                from app.core.constants import normalize_skill

                request["required_skill"] = normalize_skill(str(params["required_skill"]))
            applied["request_id"] = request["id"]

        elif canonical == "shift_windows":
            delta = int(params.get("delta_min", 0))
            for request in requests:
                request["window_start"] = minutes_to_time(
                    max(0, time_to_minutes(request["window_start"]) + delta)
                )
                request["window_end"] = minutes_to_time(
                    max(0, time_to_minutes(request["window_end"]) + delta)
                )
            applied["delta_min"] = delta

        elif canonical in _SPECIAL_TYPES:
            applied.update({k: v for k, v in params.items()})

        else:  # pragma: no cover - защита от неизвестного типа
            raise AlgorithmExecutionError(f"Неизвестный тип события: {canonical}")

        return applied, cancelled, False

    # --- Заморозка / телеметрия -------------------------------------------
    def _execution_state(
        self,
        problem: AdaptedProblem,
        base_report: dict,
        event_time: int,
        telemetry,
        engineers: list[dict],
        cancelled_ids: set[str] | None = None,
    ):
        """Выводит состояния инженеров из плана и явной телеметрии."""
        cancelled_ids = cancelled_ids or set()
        tel_by_id = {item.engineer_id: item for item in telemetry}
        eng_by_id = {e["id"]: e for e in engineers}
        completed_ids: set[str] = set()
        frozen_entries: dict[str, list[dict]] = {}
        frozen_distance: dict[str, int] = {}
        states = []
        covered: set[str] = set()

        for entry in base_report.get("routes", []):
            engineer_id = entry["engineer_id"]
            covered.add(engineer_id)
            schedule = entry.get("schedule", [])
            frozen: list[dict] = []
            committed: list[str] = []
            last_node = problem.engineer_node.get(engineer_id, 0)
            available_at = event_time
            used = False
            for row in schedule:
                if row.get("task_id") in cancelled_ids:
                    continue
                end = row.get("end_minute")
                arrival = row.get("arrival_minute")
                if end is not None and end <= event_time:
                    completed_ids.add(row["task_id"])
                    frozen.append(row)
                    last_node = problem.request_node[row["task_id"]]
                    available_at = max(available_at, int(end))
                    used = True
                elif arrival is not None and arrival <= event_time and (
                    end is None or event_time < end
                ):
                    committed.append(row["task_id"])
                    frozen.append(row)
                    last_node = problem.request_node[row["task_id"]]
                    available_at = max(available_at, int(end or event_time))
                    used = True
            frozen_entries[engineer_id] = frozen
            frozen_distance[engineer_id] = sum(int(r.get("leg_metres", 0)) for r in frozen)

            tel = tel_by_id.get(engineer_id)
            available = eng_by_id.get(engineer_id, {}).get("available", True)
            if tel:
                if tel.available_at:
                    available_at = max(event_time, time_to_minutes(tel.available_at))
                if tel.available is not None:
                    available = tel.available
                if tel.used_today is not None:
                    used = tel.used_today
                if tel.committed_task_ids:
                    committed = [
                        task_id for task_id in tel.committed_task_ids if task_id not in cancelled_ids
                    ]
            states.append(
                self.adapter.engineer_state(
                    engineer_id,
                    last_node,
                    available_at,
                    used_today=used,
                    available=available,
                    committed_task_ids=tuple(committed),
                )
            )

        for engineer in engineers:
            if engineer["id"] in covered:
                continue
            states.append(
                self.adapter.engineer_state(
                    engineer["id"],
                    problem.engineer_node[engineer["id"]],
                    event_time,
                    available=engineer.get("available", True),
                )
            )
            frozen_entries[engineer["id"]] = []
            frozen_distance[engineer["id"]] = 0
        return states, completed_ids, frozen_entries, frozen_distance

    def _try_insert_new(
        self,
        problem: AdaptedProblem,
        base_report: dict,
        frozen_entries: dict[str, list[dict]],
        new_task_id: str | None,
        *,
        prefer_earliest: bool,
    ) -> dict[str, Any] | None:
        """Вставляет новую заявку в существующий маршрут без переназначений."""
        if not new_task_id:
            return None
        index = {task.id: i for i, task in enumerate(problem.instance.tasks)}
        if new_task_id not in index:
            return None
        new_index = index[new_task_id]
        routes = report_to_index_routes(problem, base_report)
        ev = self.adapter.evaluator(problem)
        frozen_counts = {eid: len(entries) for eid, entries in frozen_entries.items()}
        best: tuple | None = None
        for k, route in enumerate(routes):
            engineer_id = problem.instance.engineers[k].id
            start_position = frozen_counts.get(engineer_id, 0)
            if not ev.route(k, route)[0]:
                continue
            base_distance = ev.route(k, route)[1]
            for position in range(start_position, len(route) + 1):
                candidate = route[:position] + (new_index,) + route[position:]
                feasible, distance, *_ = ev.route(k, candidate)
                if not feasible:
                    continue
                row = next(
                    (r for r in ev.schedule(k, candidate) if r["task_id"] == new_task_id), None
                )
                if row is None:
                    continue
                delta_km = (distance - base_distance) / 1000
                score = (
                    (row["start_minute"], delta_km)
                    if prefer_earliest
                    else (delta_km, row["start_minute"])
                )
                if best is None or score < best[0]:
                    best = (score, k, candidate)
        if best is None:
            return None
        _, best_k, best_route = best
        final_routes = list(routes)
        final_routes[best_k] = best_route
        return ev.report(final_routes)

    @staticmethod
    def _insert_respects_event(
        report: dict[str, Any], new_task_id: str | None, event_time: int | None
    ) -> bool:
        """Проверяет, что новая заявка не «прибывает» раньше события (п. 14)."""
        if event_time is None or not new_task_id:
            return True
        for route in report.get("routes", []):
            for row in route.get("schedule", []):
                if row.get("task_id") == new_task_id:
                    return (
                        int(row.get("arrival_minute", 0)) >= event_time
                        and int(row.get("start_minute", 0)) >= event_time
                    )
        return True

    def _minimal_cancel_problem(
        self,
        engineers: list[dict],
        requests: list[dict],
        base_report: dict,
        cancelled_ids: set[str],
    ) -> tuple[AdaptedProblem, dict[str, Any]] | None:
        """Локальная починка отмены: убрать заявку, остальные не передавать (п. 19)."""
        if not base_report or not cancelled_ids:
            return None
        remaining = [item for item in requests if item["id"] not in cancelled_ids]
        if not remaining:
            return None
        try:
            problem = self.adapter.prepare_problem(engineers, remaining)
            index = {task.id: i for i, task in enumerate(problem.instance.tasks)}
            routes = [
                tuple(index[tid] for tid in route.get("task_ids", []) if tid in index)
                for route in base_report.get("routes", [])
            ]
            ev = self.adapter.evaluator(problem)
            ev.key(routes)
        except (AlgorithmExecutionError, ValueError, KeyError):
            return None
        return problem, ev.report(routes)

    def _merge(
        self,
        base_report: dict,
        residual_report: dict,
        problem: AdaptedProblem,
        frozen_entries: dict[str, list[dict]],
        frozen_distance: dict[str, int],
        cancelled_ids: set[str],
    ) -> dict[str, Any]:
        """Склеивает замороженное прошлое с решением по будущему."""
        residual_routes = {r["engineer_id"]: r for r in residual_report.get("routes", [])}
        routes = []
        total_distance_m = 0
        active = 0
        for engineer in problem.engineers:
            engineer_id = engineer["id"]
            frozen = frozen_entries.get(engineer_id, [])
            residual = residual_routes.get(
                engineer_id, {"task_ids": [], "schedule": [], "distance_km": 0.0}
            )
            schedule = list(frozen) + list(residual.get("schedule", []))
            task_ids = [row["task_id"] for row in frozen] + list(residual.get("task_ids", []))
            distance_m = frozen_distance.get(engineer_id, 0) + int(
                round(float(residual.get("distance_km", 0.0)) * 1000)
            )
            total_distance_m += distance_m
            if task_ids:
                active += 1
            routes.append(
                {
                    "engineer_id": engineer_id,
                    "task_ids": task_ids,
                    "distance_km": distance_m / 1000,
                    "schedule": schedule,
                    "explanation": (
                        "Замороженное прошлое сохранено; будущие визиты пересчитаны "
                        "с минимальными изменениями."
                    ),
                }
            )

        unassigned = residual_report.get("unassigned", [])
        urgent_missing = sum(
            1
            for item in unassigned
            if problem.request_by_id.get(item["task_id"], {}).get("priority") == "urgent"
        )
        missing = len(unassigned)
        total_tasks = len(problem.requests) - len(cancelled_ids)
        return {
            "objective": [urgent_missing, missing, active, total_distance_m],
            "unassigned_urgent": urgent_missing,
            "unassigned_count": missing,
            "planned_count": max(0, total_tasks - missing),
            "active_engineers_today": active,
            "future_distance_km": total_distance_m / 1000,
            "routes": routes,
            "unassigned": unassigned,
            "metadata": residual_report.get("metadata", {}),
            "data_metadata": problem.instance.metadata,
        }

    @staticmethod
    def _mark_cancelled(api_result: dict[str, Any], cancelled_ids: set[str]) -> None:
        """Помечает отменённые заявки на карте."""
        if not cancelled_ids:
            return
        geojson = api_result.get("map_geojson") or {}
        for feature in geojson.get("features", []):
            properties = feature.get("properties", {})
            if properties.get("request_id") in cancelled_ids:
                properties["status"] = "cancelled"

    def _collect_violations(
        self, problem: AdaptedProblem, report: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Ищет нарушения ограничений в отчёте (для ручных override)."""
        violations: list[dict[str, Any]] = []
        request_by_id = problem.request_by_id
        for entry in report.get("routes", []):
            for row in entry.get("schedule", []):
                request = request_by_id.get(row["task_id"], {})
                if request and row.get("start_minute", 0) > time_to_minutes(request["window_end"]):
                    violations.append(
                        {
                            "task_id": row["task_id"],
                            "engineer_id": entry["engineer_id"],
                            "kind": "WINDOW_LATE",
                            "late_min": row["start_minute"] - time_to_minutes(request["window_end"]),
                        }
                    )
        return violations

    # --- Сценарий-блок по типу события ------------------------------------
    def _scenario_block(
        self,
        canonical: str,
        event,
        problem: AdaptedProblem,
        api_result: dict[str, Any],
        base_report: dict,
        event_time: int | None,
        applied: dict[str, Any],
    ) -> dict[str, Any]:
        """Формирует понятные детали конкретного сценария."""
        if canonical == "urgent_order_added":
            request_id = applied.get("request_id")
            assignment = next(
                (a for a in api_result.get("assignments", []) if a["request_id"] == request_id),
                None,
            )
            if not assignment:
                return {"urgent": {"order_id": request_id, "engineer_id": None, "assigned": False}}
            start_min = safe_time_to_minutes(assignment["start"])
            reaction = start_min - event_time if event_time is not None else None
            return {
                "urgent": {
                    "order_id": request_id,
                    "engineer_id": assignment["engineer_id"],
                    "arrival": assignment["arrival"],
                    "start": assignment["start"],
                    "reaction_min": reaction,
                    "reaction_target_min": 120,
                }
            }
        if canonical == "order_cancelled":
            return {
                "cancelled": {
                    "order_id": applied.get("request_id"),
                    "reason": applied.get("reason"),
                    "stage": applied.get("stage"),
                }
            }
        if canonical == "engineer_unavailable":
            return {
                "engineer_unavailable": {
                    "engineer_id": applied.get("engineer_id"),
                    "reason": applied.get("reason"),
                    "unassigned_count": len(api_result.get("unassigned", [])),
                }
            }
        if canonical == "order_added":
            request_id = applied.get("request_id")
            assignment = next(
                (a for a in api_result.get("assignments", []) if a["request_id"] == request_id),
                None,
            )
            return {
                "order_added": {
                    "order_id": request_id,
                    "inserted": assignment is not None,
                    "engineer_id": assignment["engineer_id"] if assignment else None,
                    "start": assignment["start"] if assignment else None,
                }
            }
        if canonical == "transport_changed":
            return {"transport_changed": {"engineer_id": applied.get("engineer_id"), "transport": applied.get("transport")}}
        if canonical == "order_window_changed":
            assignment = next(
                (
                    a
                    for a in api_result.get("assignments", [])
                    if a["request_id"] == applied.get("request_id")
                ),
                None,
            )
            return {
                "order_window_changed": {
                    "order_id": applied.get("request_id"),
                    "assigned": assignment is not None,
                    "new_start": assignment["start"] if assignment else None,
                }
            }
        if canonical == "engineer_delayed":
            return {"engineer_delayed": {"engineer_id": applied.get("engineer_id"), "delay_min": applied.get("delay_min")}}
        if canonical == "finished_early":
            return {"finished_early": {"engineer_id": applied.get("engineer_id"), "actual_end": applied.get("actual_end")}}
        if canonical == "engineer_available":
            return {"engineer_available": {"engineer_id": applied.get("engineer_id")}}
        if canonical == "engineer_added":
            return {"engineer_added": {"engineer_id": applied.get("engineer_id")}}
        if canonical == "order_scope_changed":
            return {"order_scope_changed": {"order_id": applied.get("request_id")}}
        if canonical == "shift_windows":
            return {"shift_windows": {"delta_min": applied.get("delta_min")}}
        return {"type": canonical, "applied": applied}

    # --- Точечные операции -------------------------------------------------
    def _load_problem(self, plan):
        input_payload = plan.input_payload or {}
        engineers = copy.deepcopy(input_payload.get("engineers", []))
        requests = copy.deepcopy(input_payload.get("requests", []))
        return self.adapter.prepare_problem(engineers, requests)

    @staticmethod
    def _total_distance_m(ev, routes) -> int:
        """Суммарный пробег маршрутов без проверки допустимости (п. 25)."""
        total = 0
        for k, route in enumerate(routes):
            try:
                total += int(ev.route(k, route)[1])
            except Exception:  # noqa: BLE001 — оценка не должна ронять проверку
                continue
        return total

    @staticmethod
    def _frozen_min_position(plan, engineer_id: str) -> int:
        """Позиция после последнего замороженного визита инженера (п. 24).

        Статусы фактов лежат в ``plan.result`` (done/in_progress/en_route), а не в
        снимке алгоритма, поэтому позицию считаем по действующей версии плана.
        """
        for route in (plan.result or {}).get("routes", []):
            if route.get("engineer_id") != engineer_id:
                continue
            last = -1
            for index, point in enumerate(route.get("route", [])):
                if point.get("status") in {"done", "in_progress", "en_route"}:
                    last = index
            return last + 1
        return 0

    def check_reassign(
        self, plan, order_id: str, to_engineer_id: str, position: int | None = None, time: str | None = None
    ) -> dict[str, Any]:
        """Проверяет ручное переназначение заявки (S2)."""
        base_report = (plan.algorithm_meta or {}).get("algorithm_report") or {}
        problem = self._load_problem(plan)
        routes = report_to_index_routes(problem, base_report)
        index = {t.id: i for i, t in enumerate(problem.instance.tasks)}
        if order_id not in index:
            raise AlgorithmExecutionError(f"Заявка {order_id} не найдена")
        task_index = index[order_id]
        if time:
            # Переназначение не раньше текущего времени дня (п. 47).
            problem.requests[task_index]["release_time"] = time_to_minutes(time)
        ev = self.adapter.evaluator(problem)
        target = next(
            (k for k, e in enumerate(problem.instance.engineers) if e.id == to_engineer_id), None
        )
        if target is None:
            raise AlgorithmExecutionError(f"Инженер {to_engineer_id} не найден")
        owner = next((k for k, r in enumerate(routes) if task_index in r), None)
        request = problem.request_by_id[order_id]
        engineer = problem.engineers[target]

        checks = self._constraint_checks(problem, request, engineer)
        checks["time"] = {
            "ok": False,
            "text": "не помещается в окно и смену у выбранного инженера",
        }

        reduced = tuple(x for x in routes[owner] if x != task_index) if owner is not None else ()
        if position is None:
            pos, *_ = ev.insert(target, routes[target], task_index)
        else:
            pos = position
        if pos >= 0:
            # Никогда не ставим заявку перед уже выполненными/начатыми визитами (п. 24).
            pos = max(int(pos), self._frozen_min_position(plan, to_engineer_id))
        feasible = pos >= 0
        candidate_target = (
            routes[target][:pos] + (task_index,) + routes[target][pos:] if feasible else routes[target]
        )
        if feasible and owner is not None and owner != target:
            feasible = ev.route(owner, reduced)[0] and ev.route(target, candidate_target)[0]
        elif feasible and owner == target:
            feasible = ev.route(target, candidate_target)[0]

        new_start = None
        shifted: list[dict[str, Any]] = []
        late: list[dict[str, Any]] = []
        if feasible:
            try:
                schedule = ev.schedule(target, candidate_target)
            except ValueError:
                schedule = []
            row = next((r for r in schedule if r["task_id"] == order_id), None)
            new_start = row["start"] if row else None
            if row:
                checks["time"] = {
                    "ok": row["start_minute"] <= time_to_minutes(request["window_end"]),
                    "text": (
                        f"начало {row['start']} в окне {request['window_start']}–"
                        f"{request['window_end']}"
                    ),
                }
                if row["start_minute"] > time_to_minutes(request["window_end"]):
                    late.append({"order_id": order_id, "late_min": row["start_minute"] - time_to_minutes(request["window_end"])})
            try:
                before = ev.schedule(target, routes[target])
            except ValueError:
                before = []
            before_by_id = {r["task_id"]: r for r in before}
            for r in schedule:
                old = before_by_id.get(r["task_id"])
                if old and old["start_minute"] != r["start_minute"]:
                    shifted.append(
                        {"order_id": r["task_id"], "delta_min": r["start_minute"] - old["start_minute"]}
                    )
        # Дистанцию считаем по маршрутам, не через ev.key: базовый план может быть
        # уже с допущенным нарушением (после force-переназначения) — это не 500 (п. 25).
        original_distance_m = self._total_distance_m(ev, routes)
        delta_km = 0.0
        if feasible:
            candidate = list(routes)
            if owner is not None:
                candidate[owner] = reduced
            candidate[target] = candidate_target
            delta_km = round(
                (self._total_distance_m(ev, candidate) - original_distance_m) / 1000, 3
            )

        return {
            "order_id": order_id,
            "to_engineer_id": to_engineer_id,
            "feasible": bool(feasible),
            "checks": checks,
            "new_start": new_start,
            "shifted_visits": shifted,
            "late_visits": late,
            "delta_km": delta_km,
        }

    def _constraint_checks(
        self, problem: AdaptedProblem, request: dict, engineer: dict
    ) -> dict[str, Any]:
        """Статические проверки навыка, транспорта и оборудования."""
        skill_ok = request["required_skill"] in engineer["skills"]
        transport_required = request.get("required_transport")
        transport_ok = not transport_required or transport_required == engineer["transport"]
        required_tools = set(request.get("required_tools", ()))
        have_tools = set(
            key for key, value in (engineer.get("kit") or {}).items() if int(value) > 0
        )
        missing_tools = sorted(required_tools - have_tools)
        equipment_ok = not missing_tools
        return {
            "skill": {
                "ok": skill_ok,
                "text": f"нужен навык «{skill_display(request['required_skill'])}», "
                f"у инженера {', '.join(skill_display(s) for s in engineer['skills'])}",
            },
            "transport": {
                "ok": transport_ok,
                "text": (
                    f"требуется {transport_display(transport_required)}"
                    if transport_required
                    else "транспорт не требуется"
                ),
            },
            "equipment": {
                "ok": equipment_ok,
                "text": (
                    "оборудование есть"
                    if equipment_ok
                    else f"нет оборудования: {', '.join(missing_tools)}"
                ),
            },
        }

    def apply_manual_reassign(
        self, plan, order_id: str, to_engineer_id: str, position: int | None, force: bool, time: str | None = None
    ) -> EventComputation:
        """Применяет ручное переназначение (S2)."""
        check = self.check_reassign(plan, order_id, to_engineer_id, position, time)
        if not check["feasible"] and not force:
            raise AlgorithmExecutionError(
                f"Переназначение невозможно: {check['checks']}. Используйте force=true для override."
            )
        base_report = (plan.algorithm_meta or {}).get("algorithm_report") or {}
        problem = self._load_problem(plan)
        routes = report_to_index_routes(problem, base_report)
        index = {t.id: i for i, t in enumerate(problem.instance.tasks)}
        task_index = index[order_id]
        if time:
            problem.requests[task_index]["release_time"] = time_to_minutes(time)
        target = next(k for k, e in enumerate(problem.instance.engineers) if e.id == to_engineer_id)
        owner = next((k for k, r in enumerate(routes) if task_index in r), None)
        reduced = tuple(x for x in routes[owner] if x != task_index) if owner is not None else ()

        ev = self.adapter.evaluator(problem)
        frozen = self._frozen_min_position(plan, to_engineer_id)
        if position is None:
            # Позицию выбирает проверка; вручную не ставим перед замороженными (п. 24).
            pos, *_ = ev.insert(target, routes[target], task_index)
            if pos < 0:
                pos = frozen
        else:
            pos = position
        pos = max(int(pos), frozen)
        candidate_target = routes[target][:pos] + (task_index,) + routes[target][pos:]
        candidate = list(routes)
        if owner is not None:
            candidate[owner] = reduced
        candidate[target] = candidate_target

        violations: list[dict[str, Any]] = []
        owner_ok = ev.route(owner, reduced)[0] if owner is not None else True
        if ev.route(target, candidate_target)[0] and owner_ok:
            try:
                report = ev.report(candidate)
            except ValueError:
                # В плане уже есть допущенные нарушения — не роняем запрос (п. 25).
                report, violations = self._report_allow_violations(problem, candidate)
        else:
            report, violations = self._report_allow_violations(problem, candidate)
        api_result = self.planner.build_api_result(problem, report, 0.0)
        changes = self.adapter.plan_changes(base_report, report)
        api_result["changes"] = changes
        api_result["violations"] = violations
        return EventComputation(
            problem=problem,
            report=report,
            api_result=api_result,
            changes=changes,
            scenario={"manual_reassign": check},
            applied_event={
                "type": "manual_reassign",
                "order_id": order_id,
                "to_engineer_id": to_engineer_id,
                "force": force,
            },
            violations=violations,
            engineers=problem.engineers,
            requests=problem.requests,
        )

    def _report_allow_violations(
        self, problem: AdaptedProblem, routes: list[tuple[int, ...]]
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Строит отчёт вручную, допуская опоздания (для force-переназначения)."""
        return report_allow_violations(problem, routes)

    def suggest(self, plan, engineer_id: str, from_time: str, to_time: str) -> dict[str, Any]:
        """Подсказывает, кого поставить освободившемуся инженеру (S8)."""
        base_report = (plan.algorithm_meta or {}).get("algorithm_report") or {}
        problem = self._load_problem(plan)
        routes = report_to_index_routes(problem, base_report)
        ev = self.adapter.evaluator(problem)
        target = next(
            (k for k, e in enumerate(problem.instance.engineers) if e.id == engineer_id), None
        )
        if target is None:
            raise AlgorithmExecutionError(f"Инженер {engineer_id} не найден")
        from_min = time_to_minutes(from_time)
        to_min = time_to_minutes(to_time)

        suggestions: list[dict[str, Any]] = []
        unassigned_ids = {item["task_id"] for item in base_report.get("unassigned", [])}
        at_risk_ids: set[str] = set()
        for entry in base_report.get("routes", []):
            for row in entry.get("schedule", []):
                if row.get("window_slack_minutes", 999) < 15:
                    at_risk_ids.add(row["task_id"])
        index_by_id = {t.id: i for i, t in enumerate(problem.instance.tasks)}
        for task_id in dict.fromkeys(list(unassigned_ids) + list(at_risk_ids)):
            source = "unassigned" if task_id in unassigned_ids else "at_risk"
            index = index_by_id.get(task_id)
            if index is None:
                continue
            pos, *_ = ev.insert(target, routes[target], index)
            if pos < 0:
                continue
            candidate = list(routes)
            candidate[target] = routes[target][:pos] + (index,) + routes[target][pos:]
            try:
                schedule = ev.schedule(target, candidate[target])
            except Exception:  # noqa: BLE001
                continue
            row = next((r for r in schedule if r["task_id"] == task_id), None)
            if not row or not (from_min <= row["start_minute"] <= to_min):
                continue
            request = problem.request_by_id.get(task_id, {})
            suggestions.append(
                {
                    "order_id": task_id,
                    "source": source,
                    "priority": request.get("priority", "normal"),
                    "start": row["start"],
                    "delta_km": 0.0,
                    "text": (
                        f"Заявка {task_id} подходит по навыку, окну и транспорту; "
                        f"начало {row['start']}."
                    ),
                }
            )
        suggestions.sort(key=lambda item: (item["priority"] != "urgent", item["start"] or ""))
        return {
            "engineer_id": engineer_id,
            "from_time": from_time,
            "to_time": to_time,
            "suggestions": suggestions[:5],
        }

    # --- Песочница и добор ресурса -----------------------------------------
    def what_if(
        self,
        plan,
        changes: list[dict[str, Any]],
        *,
        solver: str = "hybrid_v2",
        seed: int = 42,
        total_seconds: float = 5.0,
    ) -> dict[str, Any]:
        """Считает последствия набора изменений без сохранения (S14)."""
        base_report = (plan.algorithm_meta or {}).get("algorithm_report") or {}
        input_payload = plan.input_payload or {}
        engineers = copy.deepcopy(input_payload.get("engineers", []))
        requests = copy.deepcopy(input_payload.get("requests", []))
        applied_list = []
        for change in changes:
            event = ApplyEventRequest.model_validate(change)
            time_str = event.event_time_value()
            event_time = time_to_minutes(time_str) if time_str else None
            applied, _, _ = self._mutate(
                canonical_type(event.type), event, engineers, requests, event_time
            )
            applied_list.append(applied)

        started = perf_counter()
        problem = self.adapter.prepare_problem(engineers, requests)
        result = self.adapter.run(
            problem, solver=solver, seed=seed, total_seconds=total_seconds
        )
        api_result = self.planner.build_api_result(problem, result.report, perf_counter() - started)

        base_block = metric_block_from_report(base_report)
        preview_block = metric_block_from_report(result.report)
        delta = {
            "engineers_used": preview_block.engineers_used - base_block.engineers_used,
            "km_total": round(preview_block.total_distance_km - base_block.total_distance_km, 3),
            "assigned": preview_block.planned_count - base_block.planned_count,
            "unassigned_urgent": preview_block.unassigned_urgent - base_block.unassigned_urgent,
        }
        summary = (
            f"Покрытие {'+/-'}{delta['assigned']} заявок, "
            f"пробег {'+' if delta['km_total'] >= 0 else ''}{delta['km_total']} км, "
            f"инженеров {'+' if delta['engineers_used'] >= 0 else ''}{delta['engineers_used']}."
        )
        return {
            "delta_metrics": delta,
            "summary": summary,
            "preview": api_result,
            "applied_changes": applied_list,
        }

    def extend_resource(
        self,
        plan,
        order_ids: list[str],
        option: str,
        params: dict[str, Any],
        *,
        solver: str = "hybrid_v2",
        seed: int = 42,
        total_seconds: float = 5.0,
    ) -> EventComputation:
        """Добор ресурса под неназначенные заявки (S13)."""
        base_report = (plan.algorithm_meta or {}).get("algorithm_report") or {}
        input_payload = plan.input_payload or {}
        engineers = copy.deepcopy(input_payload.get("engineers", []))
        requests = copy.deepcopy(input_payload.get("requests", []))
        eng_by_id = {e["id"]: e for e in engineers}
        cost: dict[str, float] = {"extra_shift_min": 0, "extra_engineers": 0, "delta_km": 0.0}

        if option == "extend_shift":
            engineer = eng_by_id.get(str(params.get("engineer_id")))
            if engineer is None:
                raise AlgorithmExecutionError("Для extend_shift нужен существующий engineer_id")
            extend_min = int(params.get("extend_min", 30))
            engineer["shift_end"] = minutes_to_time(
                time_to_minutes(engineer["shift_end"]) + extend_min
            )
            cost["extra_shift_min"] = extend_min
        elif option in {"neighbor_region", "add_engineer"}:
            extra = params.get("engineer")
            if not extra:
                raise AlgorithmExecutionError(
                    "Для add_engineer/neighbor_region передайте инженера в params.engineer"
                )
            engineers.append(extra)
            cost["extra_engineers"] = 1
        else:
            raise AlgorithmExecutionError(f"Неизвестный option: {option}")

        started = perf_counter()
        problem = self.adapter.prepare_problem(engineers, requests)
        result = self.adapter.run(
            problem, solver=solver, seed=seed, total_seconds=total_seconds
        )
        api_result = self.planner.build_api_result(problem, result.report, perf_counter() - started)
        assigned_ids = {a["request_id"] for a in api_result.get("assignments", [])}
        closed = [oid for oid in order_ids if oid in assigned_ids]
        still = [oid for oid in order_ids if oid not in assigned_ids]
        base_block = metric_block_from_report(base_report)
        new_block = metric_block_from_report(result.report)
        cost["delta_km"] = round(new_block.total_distance_km - base_block.total_distance_km, 3)
        if still:
            # Рекомендация «не хватает +N инженера с навыком/транспортом» (7).
            request_by_id = {item["id"]: item for item in problem.requests}
            skills = sorted(
                {
                    request_by_id[oid].get("required_skill")
                    for oid in still
                    if request_by_id.get(oid, {}).get("required_skill")
                }
            )
            transports = [
                request_by_id[oid].get("required_transport")
                for oid in still
                if request_by_id.get(oid, {}).get("required_transport")
            ]
            cost["engineers_needed"] = 1
            cost["skills"] = skills
            cost["transport"] = transports[0] if transports else "car"
        return EventComputation(
            problem=problem,
            report=result.report,
            api_result=api_result,
            changes=self.adapter.plan_changes(base_report, result.report) if base_report else [],
            scenario={
                "extend_resource": {
                    "option": option,
                    "closed": closed,
                    "still_unassigned": still,
                    "cost": cost,
                }
            },
            applied_event={"type": "extend_resource", "option": option, "order_ids": order_ids},
            engineers=engineers,
            requests=requests,
        )

