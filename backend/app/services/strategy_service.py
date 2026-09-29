"""Сравнение стратегий планирования (S0): ours / fifo / dispatcher.

Стратегии:
* ``ours`` — оптимизатор (алгоритм);
* ``fifo`` — базовый вариант кейса (порядок файла, первый подходящий инженер);
* ``dispatcher`` — реальный план диспетчера, если в заявках переданы
  ``assigned_engineer``/``assigned_start`` (иначе колонка пропускается).
"""
from __future__ import annotations

import logging
from typing import Any

from app.services.algorithm_adapter import AdaptedProblem, AlgorithmAdapter, AlgorithmExecutionError
from app.services.replan_engine import report_allow_violations

logger = logging.getLogger(__name__)


class StrategyService:
    """Строит и сравнивает несколько стратегий планирования."""

    def __init__(self, adapter: AlgorithmAdapter) -> None:
        self.adapter = adapter

    def compare(
        self,
        engineers: list[dict[str, Any]],
        requests: list[dict[str, Any]],
        *,
        strategies: tuple[str, ...] = ("ours", "fifo", "dispatcher"),
        solver: str = "hybrid_v2",
        seed: int = 42,
        total_seconds: float = 5.0,
        base_plan_result: dict[str, Any] | None = None,
        base_plan_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Считает метрики по выбранным стратегиям."""
        problem = self.adapter.prepare_problem(engineers, requests)
        columns: dict[str, Any] = {}
        km_by_engineer: dict[str, dict[str, float]] = {}
        notes: list[str] = []

        if "plan" in strategies:
            if not base_plan_result or not base_plan_payload:
                notes.append("Стратегия `plan` пропущена: не передан plan_id.")
                columns["plan"] = {"strategy": "plan", "available": False}
                km_by_engineer["plan"] = {}
            else:
                plan_problem = self.adapter.prepare_problem(
                    base_plan_payload.get("engineers", []),
                    base_plan_payload.get("requests", []),
                )
                try:
                    routes = self._routes_from_result(plan_problem, base_plan_result)
                    report = self.adapter.build_report(plan_problem, routes)
                    columns["plan"] = self._column(report, "plan")
                    km_by_engineer["plan"] = self._km_by_engineer(report)
                except (AlgorithmExecutionError, ValueError):
                    # Версия с допущенными нарушениями (force-переназначение) —
                    # считаем метрики с опозданиями (п. 8).
                    routes = self._routes_from_result(plan_problem, base_plan_result)
                    report, violations = report_allow_violations(plan_problem, routes)
                    column = self._column(report, "plan")
                    column["violations"] = len(violations)
                    column["km_is_estimate"] = True
                    columns["plan"] = column
                    km_by_engineer["plan"] = self._km_by_engineer(report)

        if "incremental" in strategies:
            if not base_plan_result:
                notes.append("Стратегия `incremental` пропущена: не передан plan_id.")
            else:
                try:
                    routes = self._routes_from_result(problem, base_plan_result)
                    report = self.adapter.build_report(problem, routes)
                    columns["incremental"] = self._column(report, "incremental")
                    km_by_engineer["incremental"] = self._km_by_engineer(report)
                except AlgorithmExecutionError as exc:
                    notes.append(f"Стратегия `incremental` недоступна: {exc}")

        if "ours" in strategies:
            report = self.adapter.run(
                problem, solver=solver, seed=seed, total_seconds=total_seconds
            ).report
            columns["ours"] = self._column(report, "ours")
            km_by_engineer["ours"] = self._km_by_engineer(report)

        if "fifo" in strategies:
            routes = self.adapter.baseline_routes(problem)
            report = self.adapter.build_report(problem, routes)
            columns["fifo"] = self._column(report, "fifo")
            km_by_engineer["fifo"] = self._km_by_engineer(report)

        if "dispatcher" in strategies:
            has_dispatcher_data = any(
                request.get("assigned_engineer") or request.get("dispatcher_engineer_id")
                for request in requests
            )
            if not has_dispatcher_data:
                notes.append(
                    "Стратегия `dispatcher`: нет данных о реальном распределении заявок."
                )
                columns["dispatcher"] = {"strategy": "dispatcher", "available": False}
                km_by_engineer["dispatcher"] = {}
            else:
                routes, skipped = self._dispatcher_routes(problem)
                try:
                    report = self.adapter.build_report(problem, routes)
                    violations = 0
                except (AlgorithmExecutionError, ValueError):
                    # Реальный план диспетчера может нарушать окна/смены —
                    # нужны и километры по бригадам, и визиты для окон (п. 23).
                    report, violation_list = report_allow_violations(problem, routes)
                    violations = len(violation_list)
                column = self._column(report, "dispatcher")
                column["violations"] = violations
                column["km_is_estimate"] = True
                columns["dispatcher"] = column
                km_by_engineer["dispatcher"] = self._km_by_engineer(report)

        # Формат по спецификации: {engineer_id: {стратегия: {km, tasks}}}.
        km_spec: dict[str, dict[str, Any]] = {}
        for strategy_name, column in columns.items():
            for item in column.get("km_by_engineer", []):
                km_spec.setdefault(item["engineer_id"], {})[strategy_name] = {
                    "km": item["km"],
                    "tasks": item["tasks"],
                }
        return {
            "columns": columns,
            "km_by_engineer": km_spec,
            "notes": notes,
        }

    @staticmethod
    def _column(report: dict[str, Any], strategy: str | None = None) -> dict[str, Any]:
        planned = int(report.get("planned_count", 0))
        total = planned + int(report.get("unassigned_count", 0))
        visits_total = 0
        started_in_window = 0
        late = 0
        for route in report.get("routes", []):
            for row in route.get("schedule", []):
                visits_total += 1
                slack = row.get("window_slack_minutes")
                if slack is None:
                    continue
                if slack >= 0:
                    started_in_window += 1
                else:
                    late += 1
        return {
            "strategy": strategy,
            "available": True,
            "engineers_used": int(report.get("active_engineers_today", 0)),
            "km_total": round(float(report.get("future_distance_km", 0.0)), 3),
            "coverage_pct": round(planned / total * 100, 1) if total else 100.0,
            "unassigned_urgent": int(report.get("unassigned_urgent", 0)),
            "unassigned": int(report.get("unassigned_count", 0)),
            "visits_total": visits_total,
            "started_in_window": started_in_window,
            "late": late,
            "violations": 0,
            "km_is_estimate": False,
            "km_by_engineer": [
                {
                    "engineer_id": route["engineer_id"],
                    "km": round(float(route.get("distance_km", 0.0)), 3),
                    "tasks": len(route.get("task_ids", [])),
                }
                for route in report.get("routes", [])
            ],
        }

    @staticmethod
    def _km_by_engineer(report: dict[str, Any]) -> dict[str, float]:
        return {
            route["engineer_id"]: round(float(route.get("distance_km", 0.0)), 3)
            for route in report.get("routes", [])
        }

    @staticmethod
    def _routes_from_result(
        problem: AdaptedProblem, result: dict[str, Any]
    ) -> list[tuple[int, ...]]:
        """Переводит сохранённые маршруты плана в индексы задачи."""
        index = {request["id"]: i for i, request in enumerate(problem.requests)}
        by_engineer: dict[str, list[int]] = {engineer["id"]: [] for engineer in problem.engineers}
        for route in result.get("routes", []):
            engineer_id = route["engineer_id"]
            if engineer_id not in by_engineer:
                continue
            task_ids = route.get("task_ids")
            if task_ids is None:
                # Сохранённые API-маршруты хранят точки (`route`), а не task_ids.
                task_ids = [
                    point.get("request_id")
                    for point in route.get("route", [])
                    if point.get("request_id")
                ]
            for task_id in task_ids:
                if task_id in index:
                    by_engineer[engineer_id].append(index[task_id])
        return [tuple(by_engineer[engineer["id"]]) for engineer in problem.engineers]

    def _dispatcher_routes(self, problem: AdaptedProblem) -> tuple[list[tuple[int, ...]], int]:
        """Строит маршруты по назначениям диспетчера (ближайший сосед внутри слота)."""
        index = {request["id"]: i for i, request in enumerate(problem.requests)}
        engineer_index = {engineer["id"]: k for k, engineer in enumerate(problem.engineers)}
        buckets: dict[str, list[str]] = {engineer["id"]: [] for engineer in problem.engineers}
        skipped = 0
        for request in problem.requests:
            engineer_id = request.get("assigned_engineer") or request.get("dispatcher_engineer_id")
            if engineer_id not in engineer_index:
                skipped += 1
                continue
            buckets[engineer_id].append(request["id"])
        routes: list[tuple[int, ...]] = []
        for engineer in problem.engineers:
            ids = buckets.get(engineer["id"], [])
            ids.sort(key=lambda rid: problem.request_by_id[rid].get("assigned_start") or "99:99")
            routes.append(tuple(index[rid] for rid in ids))
        return routes, skipped

    @staticmethod
    def _lenient_report(problem: AdaptedProblem, routes: list[tuple[int, ...]]) -> dict[str, Any]:
        """Отчёт для недопустимого плана диспетчера (метрики без строгой проверки)."""
        active = sum(1 for route in routes if route)
        total_distance = 0
        for k, route in enumerate(routes):
            engineer = problem.instance.engineers[k]
            distance = problem.instance.distance_m[engineer.transport]
            prev = engineer.start_node
            for i in route:
                node = problem.instance.tasks[i].node
                total_distance += int(distance[prev, node])
                prev = node
        planned = sum(len(route) for route in routes)
        missing = len(problem.requests) - planned
        return {
            "planned_count": planned,
            "unassigned_count": missing,
            "unassigned_urgent": 0,
            "active_engineers_today": active,
            "future_distance_km": total_distance / 1000,
            "objective": [0, missing, active, total_distance],
            "routes": [
                {
                    "engineer_id": problem.instance.engineers[k].id,
                    "task_ids": [problem.instance.tasks[i].id for i in route],
                    "distance_km": 0.0,
                    "schedule": [],
                    "explanation": "План диспетчера (оценочные км).",
                }
                for k, route in enumerate(routes)
            ],
            "unassigned": [],
            "metadata": {},
        }
