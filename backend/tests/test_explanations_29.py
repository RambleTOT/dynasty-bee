"""Причина неназначения (честная, единый текст) и альтернатива в объяснении."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.services.explanation_service import (
    CAPACITY_REASON,
    _resolve_unassigned,
    _unassigned_reason,
    build_explanations,
    build_unassigned,
)

BASE = "/api/v1"


class _Problem:
    """Минимальная заглушка AdaptedProblem для юнит-тестов объяснений."""

    def __init__(self, requests: dict[str, dict]):
        self.request_by_id = requests
        self.requests: list[dict] = []
        self.engineer_by_id: dict[str, dict] = {}
        self.engineers: list[dict] = []


def test_capacity_reason_is_honest_and_unified() -> None:
    # Старый и новый код дают один и тот же текст, без «бюджета поиска».
    assert _unassigned_reason("NO_CAPACITY", "", "local") == CAPACITY_REASON
    assert _unassigned_reason("NOT_PLANNED_IN_SEARCH_BUDGET", "", "local") == CAPACITY_REASON
    assert "бюджет" not in CAPACITY_REASON.lower()
    assert "найденном плане" in CAPACITY_REASON

    problem = _Problem({"R1": {"id": "R1", "required_skill": "local"}})
    for code in ("NO_CAPACITY", "NOT_PLANNED_IN_SEARCH_BUDGET"):
        resolved_code, reason = _resolve_unassigned(
            problem, {"task_id": "R1", "code": code, "text": "старый текст"}
        )
        assert resolved_code == "NO_CAPACITY" and reason == CAPACITY_REASON


def test_unassigned_text_same_in_list_and_explanations() -> None:
    problem = _Problem({"R1": {"id": "R1", "required_skill": "local"}})
    report = {
        "routes": [],
        "unassigned": [
            {"task_id": "R1", "code": "NO_CAPACITY", "text": "старый", "proven_static": False}
        ],
    }
    unassigned = build_unassigned(problem, report)
    explanations = build_explanations(adapter=None, problem=problem, report=report)  # type: ignore[arg-type]
    assert unassigned[0].reason == CAPACITY_REASON
    assert explanations[0].status == "unassigned"
    assert explanations[0].reasons == [unassigned[0].reason]
    assert CAPACITY_REASON in explanations[0].summary


def test_assigned_explanation_has_alternative_and_order(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 3, "include_baseline": False},
    ).json()
    explanations = client.get(f"{BASE}/planning/{plan['plan_id']}/explanations").json()
    assigned = next(e for e in explanations if e["status"] == "assigned")
    assert "визит" in assigned["summary"]
    joined = " ".join(assigned["reasons"])
    assert "Альтернатива — инженер" in joined or "Других допустимых назначений" in joined
    assert "Порядок в маршруте" in joined
    # Если альтернатива есть, у неё есть начало визита и сдвиг времени.
    if assigned["local_alternatives"]:
        assert any(alt.get("start") for alt in assigned["local_alternatives"])
