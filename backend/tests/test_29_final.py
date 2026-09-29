"""Тесты docs/29_final_1: п.30 (CSV в день записей) и остаток п.38 (виды событий)."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.core.timeutils import today_str

BASE = "/api/v1"


def test_import_csv_into_booking_only_day(isolated_client) -> None:
    client, _ = isolated_client
    day = (date.fromisoformat(today_str()) + timedelta(days=7)).isoformat()
    booking = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": day, "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Одна, 1"},
    ).json()
    carry_id = booking["request_id"]
    csv = (
        "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Адрес\r\n"
        "R-CSV-1;Локальная заявка;Ремонт;14:00;16:00;Москва, ул. Два, 2\r\n"
        "\r\nАдрес офиса;Москва, ул. Юных Ленинцев, д. 83с4\r\n"
    )
    imported = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("r.csv", csv.encode("utf-8"), "text/csv")},
        data={"region_id": "east", "date": day},
    )
    assert imported.status_code == 201, imported.text
    scenario = client.get(f"{BASE}/data/scenarios/{imported.json()['scenario_id']}").json()
    ids = {r["id"] for r in scenario["requests"]}
    assert "R-CSV-1" in ids and carry_id in ids, ids


def test_realtime_publishes_more_kinds(isolated_client) -> None:
    from app.realtime.hub import hub

    client, _ = isolated_client
    before = hub.seq

    # non-started booking -> booking.created
    day = (date.fromisoformat(today_str()) + timedelta(days=9)).isoformat()
    client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": day, "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Три, 3"},
    )

    # custom region roster -> roster.changed
    region = client.post(
        f"{BASE}/regions",
        json={"name": "Тест-Р", "office": {"address": "x", "lat": 55.9, "lon": 37.4}},
    ).json()
    client.put(
        f"{BASE}/regions/{region['region_id']}/roster",
        json=[{"id": "E01", "name": "Б1", "latitude": 55.9, "longitude": 37.4,
               "shift_start": "09:00", "shift_end": "21:00", "skills": ["local"],
               "transport": "car", "available": True, "start_kind": "office"}],
    )

    # plan run -> plan.built; apply -> plan.published
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")

    kinds = {event["kind"] for event in hub.events_since(before)}
    assert {"booking.created", "roster.changed", "plan.built", "plan.published"} <= kinds, kinds
