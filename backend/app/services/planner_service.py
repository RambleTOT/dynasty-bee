"""Оркестратор планирования.

Связывает адаптер алгоритма, базовый сценарий, метрики, маршруты и
объяснения в один согласованный результат, который затем сохраняется в БД.
Сервис не содержит математики оптимизации — только вызов существующего
алгоритма и подготовку ответа для API.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from app.core.config import Settings
from app.schemas.plan import MetricBlock
from app.services.algorithm_adapter import AdaptedProblem, AlgorithmAdapter
from app.services.baseline_service import BaselineService
from app.services.explanation_service import build_explanations, build_unassigned
from app.services.metrics_service import (
    build_plan_summary,
    compare_metrics,
    metric_block_from_report,
)
from app.services.route_service import build_assignments, build_map_geojson, build_routes


@dataclass
class PlanComputation:
    """Полный результат расчёта, готовый к сохранению и отдаче в API."""

    problem: AdaptedProblem
    report: dict[str, Any]
    index_routes: list[tuple[int, ...]]
    api_result: dict[str, Any]
    metrics: dict[str, Any] | None
    algorithm_meta: dict[str, Any]
    baseline_report: dict[str, Any] | None = None
    baseline_block: MetricBlock | None = None


class PlannerService:
    """Запуск оптимизации и сборка ответа для диспетчера."""

    def __init__(self, adapter: AlgorithmAdapter, settings: Settings) -> None:
        self.adapter = adapter
        self.settings = settings
        self.baseline_service = BaselineService(adapter)

    # --- Бюджет времени ----------------------------------------------------
    def _budgets(self, time_limit: float | None) -> dict[str, float]:
        """Определяет бюджет решателя и его фаз.

        Если бюджет задан явно, фазы масштабируются пропорционально; иначе
        берутся значения из настроек.
        """
        if time_limit is None:
            return {
                "total_seconds": self.settings.solver_total_seconds,
                "warm_start_seconds": self.settings.solver_warm_start_seconds,
                "pre_master_seconds": self.settings.solver_pre_master_seconds,
                "lex_cg_seconds": self.settings.solver_lex_cg_seconds,
                "final_mip_seconds": self.settings.solver_final_mip_seconds,
            }
        total = float(time_limit)
        return {
            "total_seconds": total,
            "warm_start_seconds": round(total * 0.25, 3),
            "pre_master_seconds": round(total * 0.10, 3),
            "lex_cg_seconds": round(total * 0.45, 3),
            "final_mip_seconds": round(total * 0.20, 3),
        }

    # --- Основной расчёт ---------------------------------------------------
    def compute(
        self,
        engineers: list[dict[str, Any]],
        requests: list[dict[str, Any]],
        *,
        solver: str | None = None,
        seed: int | None = None,
        time_limit: float | None = None,
        include_baseline: bool = True,
    ) -> PlanComputation:
        """Полный цикл: адаптация данных → алгоритм → метрики → ответ."""
        problem = self.adapter.prepare_problem(engineers, requests)
        report, index_routes, elapsed = self.run_optimization(
            problem, solver=solver, seed=seed, time_limit=time_limit
        )
        api_result = self.build_api_result(problem, report, elapsed)

        baseline_report = None
        baseline_block = None
        metrics: dict[str, Any] | None = None
        if include_baseline:
            _, baseline_report = self.baseline_service.compute(problem)
            baseline_block = metric_block_from_report(baseline_report)
            optimized_block = metric_block_from_report(report)
            metrics = compare_metrics(optimized_block, baseline_block).model_dump()

        algorithm_meta = {
            "solver": solver or "hybrid_v2",
            "seed": seed if seed is not None else self.settings.solver_seed,
            "elapsed_seconds": round(elapsed, 3),
            "road_factor": problem.road_factor,
            "matrix_sources": problem.matrix_sources,
            "warnings": problem.warnings,
            "strategy": "ours",
            "version": 0,
            "algorithm_report": report,
            "solver_metadata": report.get("metadata", {}),
        }
        return PlanComputation(
            problem=problem,
            report=report,
            index_routes=index_routes,
            api_result=api_result,
            metrics=metrics,
            algorithm_meta=algorithm_meta,
            baseline_report=baseline_report,
            baseline_block=baseline_block,
        )

    def run_optimization(
        self,
        problem: AdaptedProblem,
        *,
        solver: str | None = None,
        seed: int | None = None,
        time_limit: float | None = None,
    ) -> tuple[dict[str, Any], list[tuple[int, ...]], float]:
        """Запускает решатель и возвращает отчёт, маршруты и время работы."""
        selected_solver = solver or "hybrid_v2"
        budgets = self._budgets(time_limit)
        started = perf_counter()
        result = self.adapter.run(
            problem,
            solver=selected_solver,
            seed=seed if seed is not None else self.settings.solver_seed,
            **budgets,
        )
        elapsed = perf_counter() - started
        return result.report, list(result.routes), elapsed

    # --- Сборка ответа -----------------------------------------------------
    def build_api_result(
        self, problem: AdaptedProblem, report: dict[str, Any], elapsed: float | None = None
    ) -> dict[str, Any]:
        """Преобразует отчёт алгоритма в структуру ответа API."""
        summary = build_plan_summary(report, elapsed)
        routes = build_routes(problem, report)
        assignments = build_assignments(problem, report)
        unassigned = build_unassigned(problem, report)
        explanations = build_explanations(self.adapter, problem, report)
        return {
            "summary": summary.model_dump(),
            "routes": [route.model_dump() for route in routes],
            "assignments": [assignment.model_dump() for assignment in assignments],
            "unassigned": [item.model_dump() for item in unassigned],
            "explanations": [item.model_dump() for item in explanations],
            "map_geojson": build_map_geojson(problem, report),
        }
