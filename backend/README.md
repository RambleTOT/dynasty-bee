# Маршруты инженеров — бэкенд и алгоритм

Backend-сервис на **FastAPI** для планирования маршрутов выездных инженеров оператора связи.
Распределяет заявки между инженерами, строит маршруты, отдаёт их на карту,
объясняет решения простым языком и перестраивает план при событиях рабочего дня.

Сервис — прикладной слой вокруг готового оптимизатора: принимает данные,
нормализует их и строит матрицы движения (`app/services/algorithm_adapter.py`),
затем вызывает алгоритм и переводит отчёт в ответы API. Сам алгоритм лежит в
`../routing_algorithm/beeline_optimizer_v2_final/dispatch/` и не меняется.

- Стенд: **https://api.bee-dynasty.ru**, Swagger — [`/docs`](https://api.bee-dynasty.ru/docs),
  схема — [`/openapi.json`](https://api.bee-dynasty.ru/openapi.json).
- Логика оптимизации, ограничения и метрики — [`../docs/SOLUTION.md`](../docs/SOLUTION.md).
- Тестовый набор, поля и справочники — [`../docs/DATA.md`](../docs/DATA.md).

## Требования

- Python 3.11+ (проверено на 3.12).
- Пакеты — `requirements.txt` (FastAPI, SQLAlchemy, numpy/scipy/numba).
- База данных — SQLite по умолчанию, PostgreSQL — опционально.

## Запуск (локально, SQLite)

```bash
cd backend                       # из корня репозитория
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # значения по умолчанию рассчитаны на SQLite
uvicorn app.main:app --reload --port 8000
```

- API — http://localhost:8000, Swagger — http://localhost:8000/docs.
- При старте создаются таблицы и демо-учётки. Пароль демо-учёток — значение `DEMO_PASSWORD`
  из `.env` (в `.env.example` — `change-me-on-stand`); логины: `dispatcher`, `operator`,
  `eng-east-01…12`, `eng-se-01…12`, `eng-sc-01…11`.
- Демо-день участка на сегодня создаётся сам при входе (часы `12:30`, автопрогон).
- Внешний геокодер по умолчанию выключен (`GEOCODER_PROVIDER=none`): адреса без
  координат ставятся в демо-точку, ненайденные — в офис участка и в отчёт загрузки.

## Запуск (Docker, PostgreSQL)

Из корня репозитория:

```bash
cp .env.example .env             # секреты и ключи для docker compose
docker compose up -d --build api
```

- API — http://localhost:8000 (порт слушает только localhost, наружу — nginx).
- Локальный OSRM (автомобильные маршруты) — необязательный профиль:
  ```bash
  bash osrm/init_osrm.sh
  docker compose --profile osrm up -d osrm
  ```
  Без него машина считается через OpenRouteService (если задан `ORS_API_KEY`),
  иначе по прямой.

## Тесты

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

Тесты работают на in-memory SQLite, без обращения к внешним сервисам
(ORS/local OSRM отключены, авторизация выключена). Ожидаемо — все зелёные.

## Переменные окружения

Полный список — `backend/.env.example`. Ключевые:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | `sqlite:///./beeline.db` (по умолчанию) или `postgresql+psycopg://…` |
| `DEMO_PASSWORD` | пароль демо-учёток (создаются при старте) |
| `JWT_SECRET` | секрет подписи токенов; обязательно сменить на стенде |
| `ORS_API_KEY` | ключ OpenRouteService для дорожных матриц (необязательно) |
| `GEOCODER_PROVIDER` | `yandex` / `nominatim` / `none`; `YANDEX_GEOCODER_API_KEY` для Яндекса |
| `ALLOW_DEMO_GEOCODING` | демо-точка по адресу, только для локальной отладки |
| `ALLOW_DESTRUCTIVE` | массовые `DELETE` (на публичном стенде — `false`) |
| `CORS_ORIGINS` | разрешённые источники (домены сайта) |

## Возможности API

Полный список — в Swagger (`/docs`). Основное:

| Что | Ручки |
|---|---|
| Данные | `POST /api/v1/data/load`, `/data/load-files`, `/data/load-demo`, `/data/import-beeline` |
| Участки (§14) | `GET/POST/PATCH /api/v1/regions`, `GET/PUT /api/v1/regions/{id}/roster` |
| План | `POST /api/v1/planning/run`, `GET /api/v1/planning/{id}`, `/baseline`, `/compare` |
| День | `GET /api/v1/days/{date}`, `GET /api/v1/calendar`, `GET /api/v1/planning/{id}` |
| События | `POST /api/v1/events/apply`, `GET /api/v1/events` |
| Инженер | `GET /api/v1/engineers/me/day`, `/me/route`, `POST /api/v1/engineers/me/actions` |
| Оператор | `GET /api/v1/booking/slots`, `POST /api/v1/booking/requests`, `/cancel`, `/reschedule` |
| Карта | `GET /api/v1/visualization/{plan_id}/geojson`, `.../map` |
| Живые обновления | `POST /api/v1/realtime/ticket`, `GET /api/v1/realtime/ws` |

Авторизация — JWT (заголовок `Authorization: Bearer <token>`), роли
`dispatcher` / `operator` / `engineer`.

## Структура

```
backend/
  app/
    api/routes/       ручки по разделам (data, planning, events, booking, engineers, …)
    core/             настройки, справочники (навыки, транспорт, приоритеты), участки
    schemas/          Pydantic-схемы входа/выхода
    services/         адаптер алгоритма, гео/маршруты, перепланирование, геокодер, …
    storage/          ORM-модели и репозиторий
    main.py           сборка FastAPI, middleware авторизации, CORS
  tests/              pytest
  Dockerfile          образ API (контекст сборки — корень репозитория)
  requirements*.txt   зависимости
  .env.example        шаблон окружения
routing_algorithm/    вендорный оптимизатор (dispatch), не изменяется
osrm/                 необязательный локальный OSRM (скрипт подготовки графа)
```

## Известные ограничения

Совпадают с ограничениями прототипа в корневом `README.md` и
[`../docs/SOLUTION.md`](../docs/SOLUTION.md): нормативная длительность работ,
фиксированное окно клиента, отсутствие пробок, оборудования на день и обедов,
внешний геокодер.
