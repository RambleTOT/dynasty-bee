"""Сервис обязательных метрик эффективности плана.

Метрики берутся напрямую из отчёта существующего алгоритма и не меняют его
логику. Кейс требует две обязательные метрики:
* число задействованных инженеров (уникальные исполнители хотя бы с одной заявкой);
* пробег по каждому инженеру и суммарно по плану.
Дополнительно контролируется число выполненных и неназначенных заявок.
"""
from __future__ import annotations

from typing import Any

from app.schemas.plan import MetricBlock, MetricsComparison, PlanSummary


def metric_block_from_report(report: dict[str, Any], total_requests: int | None = None) -> MetricBlock:
    """Извлекает обязательные метрики из отчёта алгоритма."""
    if total_requests is None:
        total = report.get("planned_count", 0) + report.get("unassigned_count", 0)
    else:
        total = total_requests
    return MetricBlock(
        engineers_used=int(report.get("active_engineers_today", 0)),
        total_distance_km=round(float(report.get("future_distance_km", 0.0)), 3),
        planned_count=int(report.get("planned_count", 0)),
        total_requests=int(total),
        unassigned_count=int(report.get("unassigned_count", 0)),
        unassigned_urgent=int(report.get("unassigned_urgent", 0)),
    )


def compare_metrics(optimized: MetricBlock, baseline: MetricBlock) -> MetricsComparison:
    """Сравнивает оптимизированный и базовый планы по обязательным метрикам."""
    distance_saved = round(baseline.total_distance_km - optimized.total_distance_km, 3)
    percent = (
        round(distance_saved / baseline.total_distance_km * 100, 1)
        if baseline.total_distance_km > 0
        else 0.0
    )
    return MetricsComparison(
        optimized=optimized,
        baseline=baseline,
        engineers_saved=baseline.engineers_used - optimized.engineers_used,
        distance_saved_km=distance_saved,
        distance_saved_percent=percent,
        extra_requests_planned=optimized.planned_count - baseline.planned_count,
    )


def build_plan_summary(report: dict[str, Any], elapsed_seconds: float | None = None) -> PlanSummary:
    """Формирует сводку по плану для интерфейса.

    Целевой вектор приводим к прежнему контракту API (4 элемента): срочные без
    исполнителя, всего без исполнителя, инженеров, метры. У нового алгоритма
    вектор длиннее (по рангам + мягкий штраф) — наружу отдаём совместимую форму.
    """
    return PlanSummary(
        engineers_used=int(report.get("active_engineers_today", 0)),
        total_distance_km=round(float(report.get("future_distance_km", 0.0)), 3),
        planned_count=int(report.get("planned_count", 0)),
        total_requests=int(report.get("planned_count", 0)) + int(report.get("unassigned_count", 0)),
        unassigned_count=int(report.get("unassigned_count", 0)),
        unassigned_urgent=int(report.get("unassigned_urgent", 0)),
        objective=[
            int(report.get("unassigned_urgent", 0)),
            int(report.get("unassigned_count", 0)),
            int(report.get("active_engineers_today", 0)),
            int(round(float(report.get("future_distance_km", 0.0)) * 1000)),
        ],
        elapsed_seconds=round(elapsed_seconds, 3) if elapsed_seconds is not None else None,
    )


def summarize_changes(changes: list[dict[str, Any]]) -> dict[str, int]:
    """Считает количество изменений по видам для ответа перепланирования."""
    summary = {"newly_assigned": 0, "reassigned": 0, "unassigned": 0, "position_changed": 0}
    for change in changes:
        kind = change.get("kind")
        if kind in summary:
            summary[kind] += 1
    summary["total"] = len(changes)
    return summary
