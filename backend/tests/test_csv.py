"""Тесты разбора CSV-файлов."""
from __future__ import annotations

from app.services.scenario_service import parse_engineers_csv, parse_requests_csv

ENGINEERS_CSV = (
    "id,name,latitude,longitude,shift_start,shift_end,skills,transport,available\n"
    "E1,Иван,55.75,37.62,09:00,18:00,local;installation,car,true\n"
    "E2,Пётр,55.77,37.65,10:00,19:00,emergency,bike,да\n"
)

REQUESTS_CSV = (
    "id,latitude,longitude,address,duration_minutes,window_start,window_end,priority,required_skill,required_transport\n"
    "R1,55.76,37.63,Москва,45,10:00,12:00,normal,installation,car\n"
    "R2,55.78,37.66,,30,11:00,13:00,срочная,emergency,\n"
)


def test_parse_engineers_csv() -> None:
    """CSV инженеров разбирается с навыками и доступностью."""
    engineers = parse_engineers_csv(ENGINEERS_CSV.encode("utf-8"))
    assert len(engineers) == 2
    assert engineers[0]["skills"] == ["local", "installation"]
    assert engineers[0]["transport"] == "car"
    assert engineers[0]["available"] is True
    assert engineers[1]["available"] is True


def test_parse_requests_csv() -> None:
    """CSV заявок разбирается, пустой транспорт становится None."""
    requests = parse_requests_csv(REQUESTS_CSV.encode("utf-8"))
    assert len(requests) == 2
    assert requests[0]["duration_minutes"] == 45
    assert requests[0]["required_transport"] == "car"
    assert requests[1]["required_transport"] is None
    assert requests[1]["priority"] == "срочная"
