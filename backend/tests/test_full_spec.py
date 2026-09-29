"""Полный сквозной тест API по BACKEND_SPEC.md (все ручки, разные сценарии).

Тесты идут на изолированной in-memory БД, ORS отключён (быстро и детерминированно).
"""
from __future__ import annotations

import copy

from fastapi.testclient import TestClient

from app.core.config import get_settings
from tests.test_scenarios import make_scenario

BASE = "/api/v1"


# --- Хелперы ---------------------------------------------------------------
def _demo(client: TestClient, region: str | None = None) -> dict:
    url = f"{BASE}/data/load-demo" + (f"?region_id={region}" if region else "")
    response = client.post(url)
    assert response.status_code == 201, response.text
    return response.json()


def _run(client: TestClient, scenario_id: str, **kwargs) -> dict:
    payload = {"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": True}
    payload.update(kwargs)
    response = client.post(f"{BASE}/planning/run", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def _apply(client: TestClient, plan_id: str, **event) -> dict:
    response = client.post(f"{BASE}/events/apply", json={"plan_id": plan_id, **event})
    assert response.status_code == 200, response.text
    return response.json()


def _assigned_ids(plan: dict) -> set[str]:
    return {a["request_id"] for a in plan["assignments"]}


# --- Регионы и демо-наборы -------------------------------------------------
def test_regions_shape(isolated_client) -> None:
    client, _ = isolated_client
    regions = client.get(f"{BASE}/regions").json()
    assert {r["region_id"] for r in regions} == {"east", "south_east", "south_center"}
    for region in regions:
        assert region["office"]["address"]
        assert region["request_count"] > 0 and region["engineer_count"] > 0
        assert region["demo_available"] and region["has_control"]


def test_demo_counts_per_region(isolated_client) -> None:
    client, _ = isolated_client
    expected = {"east": (12, 66), "south_east": (12, 83), "south_center": (11, 56)}
    for region_id, (eng, req) in expected.items():
        summary = _demo(client, region_id)
        assert (summary["engineer_count"], summary["request_count"]) == (eng, req)
        assert summary["region_id"] == region_id


def test_demo_legacy_without_region(isolated_client) -> None:
    client, _ = isolated_client
    summary = _demo(client)
    assert summary["request_count"] == 45


# --- Данные: load / load-files / import ------------------------------------
def test_load_scenario_with_metadata(isolated_client) -> None:
    client, _ = isolated_client
    scenario = make_scenario(3, 6, seed=1)
    scenario["scenario_metadata"] = {"region_id": "east", "date": "2026-08-17", "source": "json"}
    created = client.post(f"{BASE}/data/load", json=scenario)
    assert created.status_code == 201
    body = created.json()
    assert body["region_id"] == "east" and body["source"] == "json"
    full = client.get(f"{BASE}/data/scenarios/{body['scenario_id']}").json()
    assert full["region_id"] == "east" and full["date"] == "2026-08-17"


def test_load_files_csv(isolated_client) -> None:
    client, _ = isolated_client
    engineers_csv = (
        "id,name,latitude,longitude,shift_start,shift_end,skills,transport,available\n"
        "E1,Иван,55.75,37.62,09:00,18:00,local;installation,car,true\n"
    )
    requests_csv = (
        "id,latitude,longitude,address,duration_minutes,window_start,window_end,priority,required_skill,required_transport\n"
        "R1,55.76,37.63,Москва,30,10:00,12:00,normal,local,\n"
    )
    response = client.post(
        f"{BASE}/data/load-files",
        files={
            "engineers_file": ("engineers.csv", engineers_csv.encode(), "text/csv"),
            "requests_file": ("requests.csv", requests_csv.encode(), "text/csv"),
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["request_count"] == 1


def test_import_beeline_full(isolated_client) -> None:
    client, _ = isolated_client
    requests_csv = (
        "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение;Требуемый транспорт\r\n"
        "1;Подключение;Работа с кабелем;10:00;12:00;Даниловский;г. Москва, ул. A, д. 1;Да;Автомобиль\r\n"
        "2;Локальная заявка;Ремонт;12:00;14:00;Текстильщики;г. Москва, ул. B, д. 2;Нет;\r\n"
        "\r\nАдрес Офиса;г. Москва, ул. Юных Ленинцев, д. 83с4\r\n"
    )
    control_csv = (
        "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение;Статус BK;Бригада\r\n"
        "100000001;Подключение;Работа с кабелем;10:00;12:00;Даниловский;A, кв.5;Да;Отправлена;Бригада 1\r\n"
        "100000002;Локальная заявка;Ремонт;12:00;14:00;Текстильщики;B;Нет;Не отправлена;\r\n"
    )
    response = client.post(
        f"{BASE}/data/import-beeline",
        files={
            "requests_file": ("r.csv", requests_csv.encode("cp1251"), "text/csv"),
            "control_file": ("c.csv", control_csv.encode("cp1251"), "text/csv"),
        },
        data={"region_id": "east"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["request_count"] == 2
    assert body["import_report"]["dispatcher_assignments_loaded"] == 1
    assert body["import_report"]["required_transport"]["car"] >= 1
    full = client.get(f"{BASE}/data/scenarios/{body['scenario_id']}").json()
    # Навык из типа заявки BK.
    skills = {r["id"]: r["required_skill"] for r in full["requests"]}
    assert skills["1"] == "installation" and skills["2"] == "local"


def test_import_beeline_errors(isolated_client) -> None:
    client, _ = isolated_client
    bad = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("bad.csv", b"foo;bar\n1;2\n", "text/csv")},
        data={"region_id": "east"},
    )
    assert bad.status_code == 422 and bad.json()["detail"]["error"]["code"] == "BAD_CSV"

    # Регион не определяется по офису и не передан.
    csv_unknown = "Заявка;Тип заявки BK;Начало;Окончание;Адрес\n1;Подключение;10:00;12:00;Уфа\n"
    unknown = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("r.csv", csv_unknown.encode(), "text/csv")},
    )
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["error"]["code"] == "REGION_UNKNOWN"


def test_scenarios_filters(isolated_client) -> None:
    client, _ = isolated_client
    east = _demo(client, "east")
    south = _demo(client, "south_east")
    filtered = client.get(f"{BASE}/data/scenarios?region_id=east").json()
    ids = {item["scenario_id"] for item in filtered["items"]}
    assert east["scenario_id"] in ids and south["scenario_id"] not in ids


# --- Инженеры и часы --------------------------------------------------------
def test_engineers_management(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    engineers = client.get(f"{BASE}/data/scenarios/{scenario_id}/engineers").json()
    assert len(engineers) == 12

    added = client.post(
        f"{BASE}/data/scenarios/{scenario_id}/engineers",
        json=[{"name": "Новая", "skills": ["local"], "transport": "car"}],
    )
    assert added.status_code == 201 and added.json()["engineer_count"] == 13

    new_id = "E13"
    patched = client.patch(
        f"{BASE}/data/scenarios/{scenario_id}/engineers/{new_id}",
        json={"transport": "bike", "shift_end": "20:00"},
    )
    assert patched.status_code == 200, patched.text
    refreshed = client.get(f"{BASE}/data/scenarios/{scenario_id}/engineers").json()
    engineer = next(e for e in refreshed if e["id"] == new_id)
    assert engineer["transport"] == "bike" and engineer["shift_end"] == "20:00"


def test_clock_set_and_backward(isolated_client) -> None:
    """Часы дня (D-24): установка, автопрогон и запрет перевода назад."""
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    got = client.get(f"{BASE}/data/scenarios/{scenario_id}/clock")
    assert got.status_code == 200 and got.json()["clock"] is None
    set_clock = client.post(
        f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "12:30", "autoplay": True}
    )
    assert set_clock.status_code == 200, set_clock.text
    assert set_clock.json()["clock"] == "12:30"
    assert "autoplayed" in set_clock.json()
    backward = client.post(
        f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "09:00"}
    )
    assert backward.status_code == 409
    assert backward.json()["detail"]["error"]["code"] == "CLOCK_BACKWARD"
    reset = client.post(f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": None})
    assert reset.status_code == 200 and reset.json()["clock"] is None


def test_patch_after_publish_conflicts(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    conflict = client.patch(
        f"{BASE}/data/scenarios/{scenario_id}/engineers/E01", json={"transport": "walk"}
    )
    assert conflict.status_code == 409


# --- Планирование -----------------------------------------------------------
def test_run_plan_fields(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id)
    assert plan["status"] == "draft" and plan["strategy"] == "ours" and plan["version"] == 0
    assert plan["summary"]["total_requests"] == 66
    assert plan["metrics"]["baseline"]["total_requests"] == 66
    assert plan["map_geojson"]["metadata"]["geometry_source"] in {
        "straight_line", "osrm", "local_osrm", "openrouteservice", "mixed"
    }
    # Заявка R013-подобные неназначенные имеют причину.
    for item in plan["unassigned"]:
        assert item["reason_code"] and item["reason"]


def test_plan_get_and_explanations_and_card(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    got = client.get(f"{BASE}/planning/{plan['plan_id']}")
    assert got.status_code == 200
    assert got.json()["map_geojson"]["metadata"]["geometry_source"] in {
        "straight_line", "osrm", "local_osrm", "openrouteservice", "mixed"
    }

    explanations = client.get(f"{BASE}/planning/{plan['plan_id']}/explanations").json()
    assert len(explanations) == 66
    assigned = next(e for e in explanations if e["status"] == "assigned")
    assert assigned["reasons"]

    request_id = plan["assignments"][0]["request_id"]
    card = client.get(f"{BASE}/planning/{plan['plan_id']}/requests/{request_id}").json()
    assert card["request"]["id"] == request_id
    assert card["visit"]["request_id"] == request_id


def test_compare_strategies_and_incremental(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    response = client.post(
        f"{BASE}/planning/compare",
        json={
            "scenario_id": scenario_id,
            "plan_id": plan["plan_id"],
            "strategies": ["ours", "fifo", "dispatcher", "incremental"],
            "time_limit_seconds": 2,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "ours" in body["columns"] and "fifo" in body["columns"]
    # dispatcher есть, т.к. в demo-наборе заполнены assigned_engineer.
    assert "dispatcher" in body["columns"] and body["columns"]["dispatcher"]["km_is_estimate"]
    assert "incremental" in body["columns"]
    assert any("ours" in v for v in body["km_by_engineer"].values())


def test_baseline_endpoint(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    response = client.post(f"{BASE}/planning/baseline", json={"plan_id": plan["plan_id"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["optimized"]["total_requests"] == 66
    assert body["baseline"]["total_requests"] == 66


def test_versions_apply_reject_and_stale(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    first = client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    assert first.status_code == 200 and first.json()["status"] == "applied"
    assert first.json()["active_plan_id"] == plan["plan_id"]

    # Событие от применённого плана создаёт proposed.
    event = _apply(
        client,
        plan["plan_id"],
        type="urgent_order_added",
        event_time="12:30",
        source="operator",
        request={
            "id": "U-V1", "latitude": 55.70, "longitude": 37.76, "duration_minutes": 80,
            "window_start": "12:30", "window_end": "22:00", "priority": "urgent",
            "required_skill": "emergency",
        },
    )
    assert event["status"] == "proposed"
    new_plan_id = event["plan"]["plan_id"]
    applied = client.post(f"{BASE}/planning/{new_plan_id}/apply")
    assert applied.status_code == 200
    # Прежняя applied должна стать superseded.
    old = client.get(f"{BASE}/planning/{plan['plan_id']}").json()
    assert old["status"] == "superseded"

    # Устаревшее предложение: строим от старого (уже superseded) плана.
    stale = _apply(
        client,
        plan["plan_id"],
        type="urgent_order_added",
        event_time="12:30",
        source="operator",
        request={
            "id": "U-V2", "latitude": 55.70, "longitude": 37.76, "duration_minutes": 80,
            "window_start": "12:30", "window_end": "22:00", "priority": "urgent",
            "required_skill": "emergency",
        },
    )
    stale_apply = client.post(f"{BASE}/planning/{stale['plan']['plan_id']}/apply")
    assert stale_apply.status_code == 409
    assert stale_apply.json()["detail"]["error"]["code"] == "STALE_PROPOSAL"

    # Отклонять можно только предложение (п. 48): applied → 409.
    reject_applied = client.post(f"{BASE}/planning/{new_plan_id}/reject")
    assert reject_applied.status_code == 409
    # Новое предложение от действующей версии отклоняется.
    fresh = _apply(
        client,
        new_plan_id,
        type="urgent_order_added",
        event_time="12:30",
        source="operator",
        request={
            "id": "U-V3", "latitude": 55.70, "longitude": 37.76, "duration_minutes": 80,
            "window_start": "12:30", "window_end": "22:00", "priority": "urgent",
            "required_skill": "emergency",
        },
    )
    reject = client.post(f"{BASE}/planning/{fresh['plan']['plan_id']}/reject")
    assert reject.status_code == 200 and reject.json()["status"] == "rejected"


# --- События: все типы ------------------------------------------------------
def test_event_urgent_proposed_and_reaction(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    result = _apply(
        client, plan["plan_id"], type="urgent_order_added", event_time="12:30",
        source="operator",
        request={"id": "U-1", "latitude": 55.70, "longitude": 37.76, "duration_minutes": 80,
                 "window_start": "12:30", "window_end": "22:00", "priority": "urgent",
                 "required_skill": "emergency"},
    )
    assert result["status"] == "proposed"
    assert result["scenario"]["urgent"]["order_id"] == "U-1"
    assert "U-1" in _assigned_ids(result["plan"])


def test_event_facts_default_applied(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    engineer_id = next(r["engineer_id"] for r in plan["routes"] if r["task_count"] > 0)
    delayed = _apply(
        client, plan["plan_id"], type="engineer_delayed", event_time="12:30",
        source="engineer", engineer_id=engineer_id, params={"delay_min": 30},
    )
    assert delayed["status"] == "applied"
    assert delayed["scenario"]["engineer_delayed"]["delay_min"] == 30


def test_event_cancelled_unavailable_available_transport(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    request_id = plan["assignments"][0]["request_id"]
    engineer_id = plan["assignments"][0]["engineer_id"]

    cancelled = _apply(
        client, plan["plan_id"], type="order_cancelled", event_time="12:30",
        source="dispatcher", order_id=request_id, params={"reason": "client_refused"},
    )
    assert request_id not in _assigned_ids(cancelled["plan"])

    unavailable = _apply(
        client, plan["plan_id"], type="engineer_unavailable", event_time="12:30",
        source="dispatcher", engineer_id=engineer_id,
        params={"from": "12:30", "to": None, "finish_current": True},
    )
    assert unavailable["scenario"]["engineer_unavailable"]["engineer_id"] == engineer_id

    available = _apply(
        client, plan["plan_id"], type="engineer_available", event_time="12:30",
        source="dispatcher", engineer_id=engineer_id, params={"from": "12:30"},
    )
    assert available["scenario"]["engineer_available"]["engineer_id"] == engineer_id

    transport = _apply(
        client, plan["plan_id"], type="transport_changed", event_time="12:30",
        source="engineer", engineer_id=engineer_id, params={"transport": "walk"},
    )
    routes = {r["engineer_id"]: r for r in transport["plan"]["routes"]}
    assert routes[engineer_id]["transport"] == "walk"


def test_event_order_added_window_scope_shift(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    request_id = plan["assignments"][0]["request_id"]

    added = _apply(
        client, plan["plan_id"], type="order_added", event_time="12:30", source="client",
        request={"id": "N-1", "latitude": 55.75, "longitude": 37.70, "duration_minutes": 30,
                 "window_start": "13:00", "window_end": "18:00", "priority": "normal",
                 "required_skill": "local"},
    )
    assert added["scenario"]["order_added"]["order_id"] == "N-1"

    window = _apply(
        client, plan["plan_id"], type="order_window_changed", event_time="12:30",
        source="client", order_id=request_id,
        params={"window_start": "15:00", "window_end": "20:00"},
    )
    assert window["scenario"]["order_window_changed"]["order_id"] == request_id

    scope = _apply(
        client, plan["plan_id"], type="order_scope_changed", event_time="12:30",
        source="engineer", order_id=request_id, params={"extra_min": 20},
    )
    assert scope["scenario"]["order_scope_changed"]["order_id"] == request_id

    shifted = _apply(
        client, plan["plan_id"], type="shift_windows", event_time="12:30",
        source="dispatcher", params={"delta_min": 30},
    )
    assert shifted["scenario"]["shift_windows"]["delta_min"] == 30


def test_event_legacy_alias(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    request_id = plan["assignments"][0]["request_id"]
    response = client.post(
        f"{BASE}/events/replan",
        json={"plan_id": plan["plan_id"], "type": "request_cancelled",
              "request_id": request_id, "event_time": "12:30"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["event_type"] == "order_cancelled"


def test_event_unknown_returns_404(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    response = client.post(
        f"{BASE}/events/apply",
        json={"plan_id": plan["plan_id"], "type": "engineer_unavailable",
              "event_time": "12:30", "engineer_id": "NOPE"},
    )
    assert response.status_code == 404


def test_event_duplicate_urgent_conflict(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    existing = plan["assignments"][0]["request_id"]
    response = client.post(
        f"{BASE}/events/apply",
        json={"plan_id": plan["plan_id"], "type": "urgent_order_added", "event_time": "12:30",
              "request": {"id": existing, "latitude": 55.7, "longitude": 37.7,
                          "duration_minutes": 30, "window_start": "12:30",
                          "window_end": "18:00", "priority": "urgent",
                          "required_skill": "local"}},
    )
    assert response.status_code == 409


# --- Diff / reassign / suggest / extend / what-if --------------------------
def test_diff_after_event(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    event = _apply(
        client, plan["plan_id"], type="urgent_order_added", event_time="12:30",
        source="operator",
        request={"id": "U-DIFF", "latitude": 55.70, "longitude": 37.76, "duration_minutes": 80,
                 "window_start": "12:30", "window_end": "22:00", "priority": "urgent",
                 "required_skill": "emergency"},
    )
    diff = client.get(f"{BASE}/planning/{event['plan']['plan_id']}/diff")
    assert diff.status_code == 200, diff.text
    body = diff.json()
    assert body["summary"]["added"] + body["summary"]["newly_assigned"] >= 1
    assert body["headline"]


def test_reassign_check_and_force(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    assignment = plan["assignments"][0]
    request_id, current = assignment["request_id"], assignment["engineer_id"]
    other = next(r["engineer_id"] for r in plan["routes"] if r["engineer_id"] != current)
    check = client.post(
        f"{BASE}/planning/{plan['plan_id']}/reassign/check",
        json={"order_id": request_id, "to_engineer_id": other},
    )
    assert check.status_code == 200
    body = check.json()
    assert set(body["checks"]) >= {"skill", "time", "transport", "equipment"}

    applied = client.post(
        f"{BASE}/planning/{plan['plan_id']}/reassign",
        json={"order_id": request_id, "to_engineer_id": other, "force": True},
    )
    assert applied.status_code == 200, applied.text
    result = applied.json()
    moved = next(a for a in result["plan"]["assignments"] if a["request_id"] == request_id)
    assert moved["engineer_id"] == other


def test_suggest_returns_candidates(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    engineer_id = next(r["engineer_id"] for r in plan["routes"] if r["task_count"] > 0)
    response = client.post(
        f"{BASE}/planning/{plan['plan_id']}/suggest",
        json={"engineer_id": engineer_id, "from_time": "10:00", "to_time": "22:00"},
    )
    assert response.status_code == 200
    assert response.json()["engineer_id"] == engineer_id


def test_extend_resource_extend_shift(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    unassigned = [u["request_id"] for u in plan["unassigned"]]
    engineer_id = plan["routes"][0]["engineer_id"]
    response = client.post(
        f"{BASE}/planning/{plan['plan_id']}/extend-resource",
        json={"order_ids": unassigned, "option": "extend_shift",
              "params": {"engineer_id": engineer_id, "extend_min": 60}},
    )
    assert response.status_code == 200, response.text
    assert "cost" in response.json()


def test_extend_resource_add_engineer(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    unassigned = [u["request_id"] for u in plan["unassigned"]]
    extra = {
        "id": "E99", "name": "Доп. бригада", "latitude": 55.70, "longitude": 37.76,
        "shift_start": "10:00", "shift_end": "22:00",
        "skills": ["local", "installation", "emergency"], "transport": "car",
        "available": True, "kit": {"router": 3, "ont": 3, "tv_box": 3},
    }
    response = client.post(
        f"{BASE}/planning/{plan['plan_id']}/extend-resource",
        json={"order_ids": unassigned, "option": "add_engineer",
              "params": {"engineer": extra}, "apply": False},
    )
    assert response.status_code == 200, response.text
    assert response.json()["cost"]["extra_engineers"] == 1


def test_what_if(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    response = client.post(
        f"{BASE}/planning/{plan['plan_id']}/what-if",
        json={"changes": [{"type": "shift_windows", "params": {"delta_min": 30}}],
              "time_limit_seconds": 2},
    )
    assert response.status_code == 200, response.text
    assert "delta_metrics" in response.json() and response.json()["summary"]


# --- Booking ----------------------------------------------------------------
def test_booking_full_flow(isolated_client) -> None:
    client, _ = isolated_client
    slots = client.get(
        f"{BASE}/booking/slots?region_id=east&date=2026-09-30&type_bk=Подключение"
    ).json()
    assert len(slots["slots"]) == 6
    created = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": "2026-09-30", "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, тест", "gigabit": True},
    )
    assert created.status_code == 201
    request_id = created.json()["request_id"]
    scenario_id = created.json()["scenario_id"]

    rescheduled = client.post(
        f"{BASE}/booking/requests/{request_id}/reschedule",
        json={"new_date": "2026-10-01", "new_window": "14:00-16:00"},
    )
    assert rescheduled.status_code == 200, rescheduled.text
    assert rescheduled.json()["plan_id"]
    # Поиск записей оператора (замена callbacks, D-22).
    found = client.get(f"{BASE}/booking/requests?region_id=east&q={request_id}").json()
    assert any(item["request_id"] == request_id for item in found)
    # Перенос создал запись на новой дате.
    scenarios = client.get(f"{BASE}/data/scenarios?region_id=east&date=2026-10-01").json()
    assert scenarios["count"] >= 1


def test_booking_callbacks_removed(isolated_client) -> None:
    client, _ = isolated_client
    assert client.get(f"{BASE}/booking/callbacks").status_code == 404


# --- Инженер ----------------------------------------------------------------
def test_engineer_day_and_actions_full(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    engineer_id = next(r["engineer_id"] for r in plan["routes"] if r["task_count"] > 1)
    day = client.get(f"{BASE}/engineers/{engineer_id}/day?scenario_id={scenario_id}").json()
    visits = day["visits"]
    assert len(visits) >= 2
    first, second = visits[0], visits[1]

    assert client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "shift_start", "payload": {"transport": "car"}, "at": "10:00"},
    ).status_code == 200
    assert client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "en_route", "request_id": first["request_id"], "at": "10:05"},
    ).status_code == 200
    assert client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "start", "request_id": first["request_id"], "at": "10:10"},
    ).status_code == 200
    done = client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "complete", "request_id": first["request_id"], "at": "11:00"},
    )
    assert done.status_code == 200
    # Статус сохранился.
    refreshed = client.get(f"{BASE}/engineers/{engineer_id}/day?scenario_id={scenario_id}").json()
    target = next(v for v in refreshed["visits"] if v["request_id"] == first["request_id"])
    assert target["status"] == "done"

    # Недопустимый переход: complete без start для второй заявки.
    illegal = client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "complete", "request_id": second["request_id"]},
    )
    assert illegal.status_code == 409
    assert illegal.json()["detail"]["error"]["code"] == "ILLEGAL_TRANSITION"

    # Предложение: инженер недоступен.
    unavailable = client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "unavailable", "at": "12:00", "payload": {"reason": "sick"}},
    )
    assert unavailable.status_code == 200
    assert unavailable.json()["event_id"]


# --- Визуализация -----------------------------------------------------------
def test_visualization_modes_and_filter(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    straight = client.get(
        f"{BASE}/visualization/{plan['plan_id']}/geojson?geometry=straight"
    ).json()
    assert straight["metadata"]["geometry_source"] == "straight_line"
    engineer_id = next(
        f["properties"]["engineer_id"]
        for f in straight["features"]
        if f["properties"]["feature_type"] == "route"
    )
    filtered = client.get(
        f"{BASE}/visualization/{plan['plan_id']}/geojson?geometry=straight&engineer_id={engineer_id}"
    ).json()
    for feature in filtered["features"]:
        if feature["properties"]["feature_type"] == "route":
            assert feature["properties"]["engineer_id"] == engineer_id
    assert client.get(f"{BASE}/visualization/{plan['plan_id']}/map").status_code == 200


# --- Причины неназначения ---------------------------------------------------
def test_reason_codes(isolated_client) -> None:
    client, _ = isolated_client
    scenario = {
        "name": "причины",
        "engineers": [
            {"id": "E1", "name": "локальный пешеход", "latitude": 55.75, "longitude": 37.62,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["local"],
             "transport": "walk", "available": True, "kit": {"ont": 1}},
        ],
        "requests": [
            {"id": "NO_SKILL", "latitude": 55.76, "longitude": 37.63, "duration_minutes": 30,
             "window_start": "10:00", "window_end": "12:00", "priority": "normal",
             "required_skill": "emergency"},
            {"id": "NO_TRANSPORT", "latitude": 55.76, "longitude": 37.63, "duration_minutes": 30,
             "window_start": "10:00", "window_end": "12:00", "priority": "normal",
             "required_skill": "local", "required_transport": "car"},
            {"id": "NO_EQUIPMENT", "latitude": 55.76, "longitude": 37.63, "duration_minutes": 30,
             "window_start": "10:00", "window_end": "12:00", "priority": "normal",
             "required_skill": "local", "equipment": {"router": 1}},
            {"id": "NO_SLOT", "latitude": 55.76, "longitude": 37.63, "duration_minutes": 120,
             "window_start": "09:00", "window_end": "09:15", "priority": "normal",
             "required_skill": "local"},
        ],
    }
    scenario_id = client.post(f"{BASE}/data/load", json=scenario).json()["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    codes = {u["request_id"]: u["reason_code"] for u in plan["unassigned"]}
    assert codes["NO_SKILL"] == "NO_SKILL"
    assert codes["NO_TRANSPORT"] == "NO_TRANSPORT"
    assert codes["NO_EQUIPMENT"] == "NO_EQUIPMENT"
    assert codes["NO_SLOT"] in {"NO_DIRECT_FEASIBLE_SLOT", "NO_CAPACITY"}


# --- Удаление ---------------------------------------------------------------
def test_delete_flow_and_destructive_flag(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = _demo(client, "east")["scenario_id"]
    plan = _run(client, scenario_id, include_baseline=False)
    assert client.delete(f"{BASE}/data/scenarios/{scenario_id}").status_code == 200
    assert client.get(f"{BASE}/data/scenarios/{scenario_id}").status_code == 404
    assert client.get(f"{BASE}/planning/{plan['plan_id']}").status_code == 404

    settings = get_settings()
    original = settings.allow_destructive
    settings.allow_destructive = False
    try:
        blocked = client.delete(f"{BASE}/events")
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "DESTRUCTIVE_DISABLED"
    finally:
        settings.allow_destructive = original


# --- Авторизация ------------------------------------------------------------
def test_auth_login_and_roles(isolated_client) -> None:
    """Вход по логину/паролю (JWT) и ограничения по ролям (D-17)."""
    client, session_factory = isolated_client
    from app.services.auth_service import hash_password
    from app.storage.repository import Repository

    session = session_factory()
    repository = Repository(session)
    repository.create_user(
        login="dispatcher", name="Диспетчер", role="dispatcher",
        password_hash=hash_password("demo2026"), region_ids=["east"],
    )
    repository.create_user(
        login="operator", name="Оператор", role="operator",
        password_hash=hash_password("demo2026"), region_ids=["east"],
    )
    repository.create_user(
        login="eng-east-01", name="Инженер", role="engineer",
        password_hash=hash_password("demo2026"), region_ids=["east"], engineer_id="E01",
    )
    session.close()

    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        assert client.get(f"{BASE}/regions").status_code == 401
        assert client.get("/docs").status_code == 200  # панель входа открыта

        bad = client.post(f"{BASE}/auth/login", json={"login": "dispatcher", "password": "bad"})
        assert bad.status_code == 401
        assert bad.json()["detail"]["error"]["code"] == "UNAUTHORIZED"

        login = client.post(
            f"{BASE}/auth/login", json={"login": "dispatcher", "password": "demo2026"}
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        me = client.get(f"{BASE}/auth/me", headers=headers)
        assert me.status_code == 200 and me.json()["role"] == "dispatcher"
        assert client.get(f"{BASE}/regions", headers=headers).status_code == 200

        # Оператор: /data запрещён, /booking разрешён.
        op_token = client.post(
            f"{BASE}/auth/login", json={"login": "operator", "password": "demo2026"}
        ).json()["access_token"]
        op_headers = {"Authorization": f"Bearer {op_token}"}
        assert client.get(f"{BASE}/data/scenarios", headers=op_headers).status_code == 403
        assert client.get(f"{BASE}/booking/slots?region_id=east&date=2026-09-30",
                          headers=op_headers).status_code == 200

        # Инженер: /planning запрещён, /engineers/me разрешён.
        eng_token = client.post(
            f"{BASE}/auth/login", json={"login": "eng-east-01", "password": "demo2026"}
        ).json()["access_token"]
        eng_headers = {"Authorization": f"Bearer {eng_token}"}
        assert client.get(f"{BASE}/planning", headers=eng_headers).status_code == 403
        assert client.get(f"{BASE}/engineers/me/day", headers=eng_headers).status_code in {200, 404}
    finally:
        settings.auth_enabled = original
