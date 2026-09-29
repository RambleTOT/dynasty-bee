"""Сервис базового сценария для сравнения эффективности.

Базовый план строится ровно так, как описано в кейсе: заявки обрабатываются
в порядке поступления, назначаются первому подходящему инженеру, а порядок
посещения совпадает с порядком назначения. Глобальная оптимизация не
выполняется. Реализация берётся из существующего алгоритма (``dispatch.baseline``).
"""
from __future__ import annotations

from typing import Any

from app.services.algorithm_adapter import AdaptedProblem, AlgorithmAdapter


class BaselineService:
    """Построение базового плана и его отчёта."""

    def __init__(self, adapter: AlgorithmAdapter) -> None:
        self.adapter = adapter

    def compute(self, problem: AdaptedProblem) -> tuple[list[tuple[int, ...]], dict[str, Any]]:
        """Возвращает маршруты и отчёт базового плана."""
        routes = self.adapter.baseline_routes(problem)
        report = self.adapter.build_report(
            problem,
            routes,
            metadata={"strategy": "baseline", "description": "Порядок заявок, первый подходящий инженер, добавление в конец"},
        )
        return routes, report
