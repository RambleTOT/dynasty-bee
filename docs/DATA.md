# Тестовый набор данных

Документ описывает только то, что реализовано в коде. Источники данных — генератор
синтетики `backend/app/services/region_dataset.py`, встроенный демо-файл
`backend/app/data/demo_scenario.json`, импорт CSV `backend/app/services/beeline_import.py`
и образцы в `test_data/`.

## 1. Сколько заявок и инженеров

| Набор | Инженеры | Заявки | Где в коде |
|---|---:|---:|---|
| Встроенный демо-сценарий | 12 | 45 | `backend/app/data/demo_scenario.json` (`metadata.synthetic=true`, `seed=20260917`) |
| Демо-день Востока (`east`) | 12 | 66 | `backend/app/core/regions.py: REGIONS`, генерируется `region_dataset.build_region_scenario` |
| Демо-день Юго-востока (`south_east`) | 12 | 83 | там же |
| Демо-день Югоцентра (`south_center`) | 11 | 56 | там же |
| `test_data/requests.csv` | — | 2 | файл-образец (2 строки + строка офиса) |
| `test_data/control.csv` | — | 2 | контрольный файл (2 строки, колонка «Бригада») |

Для регионов в `REGIONS` также заданы `dispatcher_assignments` (64/83/56) и
`car_requests` (7/15/2) — используются генератором как ориентиры.

Свои участки (§14) хранятся в таблице `regions`; число инженеров — `len(roster)`,
заявок — из последней загрузки (`RegionRecord.request_count`).

**Форматы загрузки: CSV и JSON.**

| Формат | Как загрузить | Что внутри |
|---|---|---|
| CSV в выданном формате | интерфейс диспетчера, «Загрузить CSV» → `POST /api/v1/data/import-beeline` | файл заявок участка и, по желанию, контрольное распределение; разбор — §5 и §6 |
| JSON | только через API (Swagger `/docs`, вход диспетчером): `POST /api/v1/data/load` — тело `{"name": …, "engineers": [...], "requests": [...]}`; `POST /api/v1/data/load-files` — файлы `engineers_file` и `requests_file` с расширением `.json` (массив объектов или `{"items": [...]}`) или `.csv` | поля заявки — §2, инженера — §3; готовый пример — `backend/app/data/demo_scenario.json` |

Сценарий из JSON планируется так же: `POST /api/v1/planning/run` с его `scenario_id`,
план — `GET /api/v1/planning/{id}`, маршруты для карты — `GET /api/v1/visualization/{plan_id}/geojson`.
В календаре диспетчера такой сценарий не появляется: у него нет участка и даты.
Проверено 29.09.2026 на `demo_scenario.json`: 12 инженеров, 45 заявок — план за 1,7 с,
назначены все 45 заявок.

## 2. Поля заявки

Схемы: вход — `backend/app/schemas/request.py: RequestIn`, выход — `RequestOut`.

| Поле | Тип | Единица | Пример | Примечание (из кода) |
|---|---|---|---|---|
| `id` | str | — | `"R001"` | 1–64 символа, уникален в задаче |
| `latitude` | float \| null | градусы WGS84 | `55.762` | задаётся вместе с `longitude` |
| `longitude` | float \| null | градусы WGS84 | `37.63` | задаётся вместе с `latitude` |
| `address` | str \| null | — | `"Москва, ул. Примерная, 1"` | до 500 символов; если нет координат — геокодируется |
| `duration_minutes` | int | минуты | `45` | работа на адресе, **без дороги**; 1…1440 |
| `window_start` | str | `HH:MM` | `"10:00"` | начало окна визита |
| `window_end` | str | `HH:MM` | `"12:00"` | конец окна; не раньше `window_start` |
| `priority` | str | — | `"normal"` | `normal`/«Обычная» или `urgent`/«Срочная» |
| `required_skill` | str | — | `"installation"` | `local` / `installation` / `emergency` (или русское название) |
| `required_transport` | str \| null | — | `"car"` | `car`/`walk`/`bike`/`public_transport`; `null` — ограничения нет |
| `equipment` | dict[str,int] | шт. | `{"router": 1}` | требуемое оборудование (Max) |
| `min_skill_level` | int | уровень | `1` | 1…5 |
| `assigned_engineer` | str \| null | — | `"E05"` | план реального диспетчера (стратегия `dispatcher`) |
| `assigned_start` | str \| null | `HH:MM` | `"10:30"` | плановое начало из плана диспетчера |
| `dispatcher_engineer_id` | str \| null | — | `"E05"` | назначение диспетчера (колонка «Бригада») |
| `external_id` | str \| null | — | `"100000001"` | ID во внешней системе |
| `type_bk` | str \| null | — | `"Подключение"` | тип заявки BK |
| `type_hd` | str \| null | — | `"Конвергенция абонента"` | тип заявки HD |
| `district` | str \| null | — | `"Даниловский"` | район |
| `gigabit` | bool | — | `false` | гигабитное подключение |
| `technology` | str \| null | — | `"FMC"` | технология: FMC / FTTB / null |
| `priority_rank` | int | — | `1` | 1 — Авария, 2 — Подключение, 3 — Локальная/Дозаказ |
| `source` | str | — | `"csv"` | csv / operator / dispatcher / helpdesk |
| `client_window_locked` | bool | — | `false` | окно зафиксировано клиентом |
| `release_time` | int | минуты от начала суток | `0` | время появления заявки |

Выход `RequestOut` дополнительно содержит `required_skill_display`,
`required_transport_display`, `status`, `flags`, `cancel_reason`, `rescheduled_to`.

## 3. Поля инженера

Схемы: `backend/app/schemas/engineer.py: EngineerIn` / `EngineerOut`.

| Поле | Тип | Единица | Пример |
|---|---|---|---|
| `id` | str | — | `"E01"` |
| `name` | str | — | `"Иван Петров"` |
| `latitude` | float | градусы WGS84 | `55.751244` |
| `longitude` | float | градусы WGS84 | `37.618423` |
| `shift_start` | str | `HH:MM` | `"09:00"` |
| `shift_end` | str | `HH:MM` | `"18:00"` |
| `skills` | list[str] | — | `["local","installation"]` (1–3) |
| `transport` | str | — | `"car"` |
| `available` | bool | — | `true` |
| `kit` | dict[str,int] | шт. | `{"router": 2}` |
| `skill_levels` | dict[str,int] | уровень | `{"emergency": 3}` |
| `start_kind` | str | — | `office` / `home` |
| `available_until` | str \| null | `HH:MM` | `null` |
| `shift_status` | str | — | `not_started` / `on_shift` / `unavailable` / `finished` |
| `actual_transport` | str \| null | — | `null` |

## 4. Справочники

Источник — `backend/app/core/constants.py`.

**Навыки** (`SKILL_ALIASES` → канонический ключ; отображение `SKILL_DISPLAY`):

| Ключ | Русские варианты | Отображение |
|---|---|---|
| `local` | «Локальные работы», «локальные» | Локальные работы |
| `installation` | «Работы на подключение и дозаказы», «работы на подключение», «подключение», «дозаказы» | Работы на подключение и дозаказы |
| `emergency` | «Аварийные работы», «аварийные» | Аварийные работы |

**Типы транспорта** (`TRANSPORT_ALIASES` → ключ; `TRANSPORT_DISPLAY`):

| Ключ | Русские варианты | Отображение |
|---|---|---|
| `car` | «Автомобиль», «машина», «авто» | Автомобиль |
| `walk` | «Пешеход», «пешком» | Пешеход |
| `bike` | «Велосипед» | Велосипед |
| `public_transport` | «Общественный транспорт», «общественный» | Общественный транспорт |

**Приоритет** (`PRIORITY_ALIASES`): `normal`/«Обычная»/«обычный» и
`urgent`/«Срочная»/«срочный». Ранг `priority_rank`: 1 — Авария, 2 — Подключение,
3 — Локальная/Дозаказ.

Правило транспорта D-06 (в редакции D-40): автомобиль нужен только при
`Тип заявки HD = «Работа с кабелем»` или `«Авария»` (`CAR_RULE_HD`), если
`required_transport` не задан явно. Гигабит из правила исключён.

## 5. Как типы заявок из CSV маппятся на навыки и длительность

Нормативы участков кейса — `backend/app/core/regions.py: BEELINE_NORMS`, они же в
`beeline_import._SKILL_BY_TYPE` / `_DURATION_BY_TYPE`:

| `Тип заявки BK` | Навык | Длительность, мин |
|---|---|---:|
| Подключение | `installation` | 70 |
| Дозаказ | `installation` | 20 |
| Локальная заявка | `local` | 30 |
| Глобальная проблема | `emergency` | 80 |

При импорте приоритет значений (для своего участка — нормативы участка `norm_for`):
колонка `Навык` → норматив участка по `type_bk` → `local`; колонка `Длительность` →
норматив участка по `type_bk` → 30. Если тип не распознан, он попадает в
`import_report.unknown_types`. Срочность: авария по HD «Авария», без HD — по навыку;
`priority_rank` = 1/2/3 по навыку (`beeline_import`, `region_dataset`).

Идентификаторы типов BK в файле приводятся к каноническим названиям `_BK_ALIASES`
(«подключение» → «Подключение» и т.д.).

## 6. Проблемы в данных и что с ними сделали

| Проблема | Что сделано | Где в коде |
|---|---|---|
| Хвост пустых колонок у адреса офиса (`;;;;;;`) | обрезается `rstrip(";")` | `beeline_import._prepare_rows` |
| Кодировка CSV | декодирование `utf-8-sig` или `cp1251` | `beeline_import._decode`, `scenario_service._decode_csv` |
| Пустое окно (нет `Начало`/`Окончание`) | берётся смена участка | `beeline_import._parse_window` (значения по умолчанию `SHIFT_START`/`SHIFT_END`) |
| «Полное окно» `00:01`–`23:59` | трактуется как вся смена | `beeline_import._parse_window` |
| Дата в формате `ДД.ММ.ГГГГ` или `ГГГГ-ММ-ДД` | нормализуется к `ГГГГ-ММ-ДД` | `beeline_import._parse_date` |
| Разная длина `requests_file` и `control_file` | ошибка `ROWS_MISMATCH` | `beeline_import.import_beeline` |
| Нет обязательных колонок CSV | ошибка `BAD_CSV` со списком найденных | `beeline_import._require_columns` |
| Неизвестный регион | ошибка `REGION_UNKNOWN` | `beeline_import.import_beeline`, `data.import_beeline_csv` |
| Бригада из контрольного файла не совпала с ростером | берётся шаблон ростера по кругу с **новым уникальным id** | `beeline_import._engineers_from_control` |
| У файла бригад нет координат (значение по умолчанию 55.75, 37.62) | у своего участка заменяются на офис участка | `beeline_import.import_beeline` |
| Нечисловые/вне диапазона `Навык`/`Длительность`/`Широта`/`Долгота` | игнорируются, берётся норматив/геокодер/офис | `beeline_import._row_skill/_row_duration/_row_point` |
| Координаты заявки не заданы | демо-геокодинг (участки кейса) или геокодер с кэшем; иначе точка офиса | `scenario_service._ensure_coordinates`, `beeline_import`, `geocoder.py` |
| Геокодер вернул точку вне рамки региона | точка отбрасывается, адрес в `geocode_fallback` | `backend/app/services/geocoder.py: _in_bbox` |
| Nominatim не понимает «г.»/«д.» | адрес нормализуется перед запросом | `geocoder.py: _nominatim` |
| `window_end` раньше `window_start` | ошибка валидации 422 | `schemas/request.py: RequestIn._check_window` |
| Задана только одна координата | ошибка валидации 422 | `schemas/request.py: RequestIn._check_window` |
| Ростер кейса менялся после перезапуска (`hash()` строк) | заменено на `zlib.crc32` | `region_dataset.build_region_scenario` |
| Дубли ID инженеров/заявок | ошибки `prepare_problem` / валидатор | `algorithm_adapter.prepare_problem`, `dispatch/model.py: Instance._check_unique_ids` |
| Дубли номера заявки при добавлении события | ошибка `DUPLICATE_REQUEST` | `events._apply_event_impl` |
| Запись оператора на день с активными записями | ошибка `DATE_HAS_BOOKINGS` (отменённые не считаются) | `data._guard_day_conflict` |
| Слишком большой сценарий | ошибка 422 по `MAX_ENGINEERS`/`MAX_REQUESTS` | `data._validate_limits` |
| Одинаковые номера заявок в демо-наборах разных регионов | при отмене/переносе заявка ищется в дне `region_id`+`date` | `booking._find_request` |

## 7. Принятые допущения (из кода)

- Встроенный демо-набор помечен `metadata.synthetic=true`; в его `assumption`:
  «Координаты синтетические, дорожный коэффициент и скорости — упрощённые.»
- Региональная синтетика (`region_dataset.build_region_scenario`): смена 10:00–22:00
  (`SHIFT_START`/`SHIFT_END`), окна — двухчасовые слоты 10:00–22:00, навыки
  сэмплируются 1–3 из трёх, транспорт чередуется `car/walk/bike/public_transport/car`,
  в 95% заявок проставлен `dispatcher_engineer_id`, число «автомобильных» заявок
  ограничивается целевым `car_requests`.
- Длительность `duration_minutes` — работа на адресе без дороги.
- Расстояния/время: car — локальный OSRM, иначе математика (см. `SOLUTION.md` §6);
  дорожный коэффициент 1.28 (конфиг), `MATH_ROAD_FACTOR` 1.3.
- Скорости математической модели: walk 4.5, bike 14, public 18/35 км/ч с ожиданием
  10/15 мин (`constants.py`).
- Демо-геокодирование адреса — детерминированный хэш внутри рамки Москвы
  (`geo.demo_geocode`); реальный геокодер — Яндекс/Nominatim с рамкой `GEOCODER_BBOX`.
- `release_time` — минуты от начала суток; в импорте всегда 0, в событиях — время события.
- Замороженные визиты (факты) в алгоритме передаются как `locked_prefix`/`committed_task_ids`.

## 8. Будущие доработки

- **Время поступления заявки.** Импорт будет брать `release_time` из данных (минуты от
  начала суток); сейчас он ставит 0 — все заявки дня доступны с начала смены.
- **Полный справочник типов.** Подключим полный перечень типов BK/HD; сейчас типы вне
  нормативов попадают в `unknown_types` отчёта импорта.
- **«Статус BK» контрольного файла.** Будем учитывать его при сравнении с реальным
  диспетчером; сейчас из контрольного файла читается только «Бригада».
- **Поля `zone`, `service_by_engineer`, `used_today`.** Модель их поддерживает, импорт
  будет их заполнять — см. [SOLUTION.md](SOLUTION.md) §7.
