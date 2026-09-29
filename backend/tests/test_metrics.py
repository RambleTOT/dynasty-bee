"""Модульные тесты сервиса метрик."""
from __future__ import annotations

from app.services.metrics_service import (
    build_plan_summary,
    compare_metrics,
    metric_block_from_report,
    summarize_changes,
)


def test_metric_block_from_report() -> None:
    """Метрики извлекаются из отчёта алгоритма без изменения логики."""
    report = {
        "active_engineers_today": 5,
        "future_distance_km": 42.5,
        "planned_count": 30,
        "unassigned_count": 2,
        "unassigned_urgent": 1,
    }
    block = metric_block_from_report(report)
    assert block.engineers_used == 5
    assert block.total_distance_km == 42.5
    assert block.total_requests == 32
    assert block.unassigned_urgent == 1


def test_compare_metrics_computes_savings() -> None:
    """Сравнение считает экономию инженеров, пробега и заявок."""
    optimized = metric_block_from_report(
        {"active_engineers_today": 5, "future_distance_km": 70, "planned_count": 100, "unassigned_count": 0}
    )
    baseline = metric_block_from_report(
        {"active_engineers_today": 8, "future_distance_km": 120, "planned_count": 90, "unassigned_count": 10}
    )
    comparison = compare_metrics(optimized, baseline)
    assert comparison.engineers_saved == 3
    assert comparison.distance_saved_km == 50.0
    assert comparison.extra_requests_planned == 10


def test_build_plan_summary_objective() -> None:
    """Сводка содержит лексикографическую цель плана."""
    report = {
        "objective": [0, 1, 5, 70000],
        "active_engineers_today": 5,
        "future_distance_km": 70,
        "planned_count": 99,
        "unassigned_count": 1,
    }
    summary = build_plan_summary(report, elapsed_seconds=2.5)
    assert summary.objective == [0, 1, 5, 70000]
    assert summary.elapsed_seconds == 2.5


def test_summarize_changes() -> None:
    """Сводка изменений считает виды перестроений."""
    changes = [
        {"task_id": "A", "kind": "newly_assigned"},
        {"task_id": "B", "kind": "reassigned"},
        {"task_id": "C", "kind": "reassigned"},
        {"task_id": "D", "kind": "unassigned"},
        {"task_id": "E", "kind": "position_changed"},
    ]
    summary = summarize_changes(changes)
    assert summary["newly_assigned"] == 1
    assert summary["reassigned"] == 2
    assert summary["unassigned"] == 1
    assert summary["position_changed"] == 1
    assert summary["total"] == 5
