"""Diff двух версий плана (формат §8.5 BACKEND_SPEC)."""
from __future__ import annotations

from typing import Any

from app.schemas.extras import DiffSummary, EngineerDiff, PlanDiffResponse
from app.schemas.validators import safe_time_to_minutes


def _assignment_map(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """request_id → {engineer_id, position, start} для назначенных заявок."""
    mapping: dict[str, dict[str, Any]] = {}
    for route in result.get("routes", []):
        for position, point in enumerate(route.get("route", []), start=1):
            mapping[point["request_id"]] = {
                "engineer_id": route["engineer_id"],
                "position": position,
                "start": point.get("start"),
            }
    return mapping


def _metrics(result: dict[str, Any]) -> dict[str, Any]:
    summary = result.get("summary", {})
    return {
        "engineers_used": summary.get("engineers_used", 0),
        "km_total": summary.get("total_distance_km", 0.0),
        "planned": summary.get("planned_count", 0),
        "unassigned": summary.get("unassigned_count", 0),
    }


def build_diff(
    base_result: dict[str, Any],
    new_result: dict[str, Any],
    base_plan_id: str,
    new_plan_id: str,
) -> PlanDiffResponse:
    """Строит понятный диспетчеру diff между двумя планами."""
    before = _assignment_map(base_result)
    after = _assignment_map(new_result)
    base_unassigned = {item["request_id"] for item in base_result.get("unassigned", [])}
    new_unassigned = {
        item["request_id"]: item for item in new_result.get("unassigned", [])
    }
    new_unassigned_ids = set(new_unassigned)

    summary = DiffSummary()
    changes: list[dict[str, Any]] = []
    all_ids = set(before) | set(after) | base_unassigned | new_unassigned_ids

    for request_id in sorted(all_ids):
        old = before.get(request_id)
        new = after.get(request_id)
        if old is None and new is not None:
            if request_id in base_unassigned:
                summary.newly_assigned += 1
                kind = "newly_assigned"
            else:
                summary.added += 1
                kind = "added"
            changes.append(
                {
                    "type": kind,
                    "request_id": request_id,
                    "engineer_id": new["engineer_id"],
                    "new_start": new["start"],
                }
            )
        elif old is not None and new is None:
            if request_id in new_unassigned_ids:
                summary.newly_unassigned += 1
                item = new_unassigned[request_id]
                changes.append(
                    {
                        "type": "newly_unassigned",
                        "request_id": request_id,
                        "reason_code": item.get("reason_code"),
                    }
                )
            else:
                summary.removed += 1
                changes.append({"type": "removed", "request_id": request_id, "reason": "cancelled"})
        elif old is not None and new is not None:
            if old["engineer_id"] != new["engineer_id"]:
                summary.reassigned += 1
                changes.append(
                    {
                        "type": "reassigned",
                        "request_id": request_id,
                        "from_engineer_id": old["engineer_id"],
                        "to_engineer_id": new["engineer_id"],
                        "old_start": old["start"],
                        "new_start": new["start"],
                    }
                )
            elif old["position"] != new["position"]:
                summary.reordered += 1
                changes.append(
                    {
                        "type": "reordered",
                        "request_id": request_id,
                        "engineer_id": new["engineer_id"],
                        "old_position": old["position"],
                        "new_position": new["position"],
                    }
                )
            elif old["start"] != new["start"]:
                summary.time_shifted += 1
                changes.append(
                    {
                        "type": "time_shifted",
                        "request_id": request_id,
                        "engineer_id": new["engineer_id"],
                        "old_start": old["start"],
                        "new_start": new["start"],
                        "delta_minutes": safe_time_to_minutes(new["start"])
                        - safe_time_to_minutes(old["start"]),
                    }
                )
            else:
                summary.untouched += 1

    km_before = {
        route["engineer_id"]: float(route.get("distance_km", 0.0))
        for route in base_result.get("routes", [])
    }
    km_after = {
        route["engineer_id"]: float(route.get("distance_km", 0.0))
        for route in new_result.get("routes", [])
    }
    engineers = [
        EngineerDiff(
            engineer_id=engineer_id,
            km_before=round(km_before.get(engineer_id, 0.0), 3),
            km_after=round(km_after.get(engineer_id, 0.0), 3),
            route_changed=any(
                change.get("engineer_id") == engineer_id
                or change.get("from_engineer_id") == engineer_id
                or change.get("to_engineer_id") == engineer_id
                for change in changes
            ),
        )
        for engineer_id in sorted(set(km_before) | set(km_after))
    ]

    headline_parts: list[str] = []
    if summary.added or summary.newly_assigned:
        headline_parts.append(f"добавлено {summary.added + summary.newly_assigned}")
    if summary.reassigned:
        headline_parts.append(f"переназначено {summary.reassigned}")
    if summary.time_shifted:
        headline_parts.append(f"сдвинуто по времени {summary.time_shifted}")
    if summary.newly_unassigned:
        headline_parts.append(f"осталось без исполнителя {summary.newly_unassigned}")
    headline = "; ".join(headline_parts) or "существенных изменений нет"

    return PlanDiffResponse(
        base_plan_id=base_plan_id,
        new_plan_id=new_plan_id,
        summary=summary,
        changes=changes,
        engineers=engineers,
        metrics_before=_metrics(base_result),
        metrics_after=_metrics(new_result),
        headline=headline,
    )
