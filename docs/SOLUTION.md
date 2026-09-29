# Логика оптимизации (решение)

Документ описывает только то, что реализовано в коде. Ссылки — на файлы репозитория.
Внешний планировщик лежит в `routing_algorithm/beeline_optimizer_v2_final/dispatch/`
(интеграция — `backend/app/services/algorithm_adapter.py`).

## 1. Что максимизируем и в каком порядке

План сравнивается **лексикографически**: строго по порядку компонент, более важная
компонента никогда не обменивается на менее важную. Вектор задан в
`dispatch/evaluate.py: Evaluator.key`:

1. **число срочных (ранг 1) заявок без исполнителя** — `unassigned_rank1`
   (в API — `unassigned_urgent`);
2. **число заявок ранга 2 (подключения) без исполнителя** — `unassigned_rank2`;
3. **число заявок ранга 3 (локальные / дозаказы) без исполнителя** — `unassigned_rank3`;
4. **число задействованных инженеров** — `active_engineers_today`;
5. **суммарный пробег** — метры;
6. **мягкий штраф** за лишние переезды между зонами — `soft_penalty`.

Ранг заявки: `1 if task.urgent else task.priority_rank` (`dispatch/evaluate.py: _rank`).
Бэкенд заполняет `priority_rank` так: авария/навык `emergency` → 1, `installation` → 2,
иначе → 3 (`backend/app/services/algorithm_adapter.py: _normalize_request`).

При **перепланировании** (есть снимок прошлого плана) в MILP-сборке между «инженерами»
и «метрами» добавляется цель `stability_units` (`dispatch/master.py: build_master`,
`_stability_units`): другой инженер — **+4**, другой порядок — **+1**. В статическом
плане (`previous_assignment` пуст) она равна 0.

Порядок из `dispatch/search.py: solve` (`meta['algorithm']`):
`ALNS + feasible local search + lexicographic HiGHS route-pool master`.
Ограничения поиска (`meta['limitations']`): матрицы статичны на снимок; глобальная
оптимальность не заявляется, если пул маршрутов не перебран целиком; заданный лимит
времени — мягкий.

## 2. Как работает алгоритм распределения (пошагово)

1. **Подготовка задачи** — `backend/app/services/algorithm_adapter.py: prepare_problem`:
   строится список узлов (сначала старты инженеров, затем точки заявок), матрицы
   расстояний/времени, `dispatch.Task`/`dispatch.Engineer` и `dispatch.Instance`;
   вызывается `instance.validate()`.
2. **Запуск** — `backend/app/services/algorithm_adapter.py: run`:
   по умолчанию (`solver="hybrid_v2"`) — `dispatch.solve_production` с `ProductionConfig`
   (`seed`, `total_seconds`, `warm_iterations`, `master_seconds`); `solver="alns"` —
   `dispatch.solve` с `SearchConfig`.
3. **`dispatch/production.py: solve_production`**: при `use_column_generation=False`
   (значение по умолчанию) вызывает `dispatch.solve` с `SearchConfig`
   (`iterations`, `restarts`, `time_limit_seconds`, `master_seconds`, `use_master=True`).
   Ветка column generation включается только флагом и в боевом режиме не используется.
4. **`dispatch/search.py: solve`**:
   - проверка замороженных префиксов `locked` (`ev.route`); недопустимый префикс →
     `ValueError` («нужно вмешательство диспетчера»);
   - стартовый план: `dispatch/evaluate.py: baseline` (FIFO); если передан
     `initial_routes` и он лучше по `ev.key`, берётся он;
   - несколько стартовых планов: `repair` со стратегиями `restart % 6` (жадная вставка
     с «сожалением»), затем `local_descent`;
   - **ALNS**: 6 операторов разрушения (`destroy`: `random`, `related`, `whole_route`,
     `worst_arc`, `string`, `time_bottleneck`) + `repair`; веса операторов адаптивны;
     отжиг допускает временное ухудшение **только километров** при равенстве первых
     четырёх компонент вектора; каждые 75 итераций — локальный спуск, каждые 200 —
     перезапуск;
   - планы «с запасом» по времени (`buffer_restarts`, `buffer=1.10`/`1.20` в
     `SearchConfig`) пополняют пул;
   - **MILP-сборка** `dispatch/master.py: recombine`: переменные — по одной на маршрут
     из пула и по одной «без исполнителя» на заявку; строки — «заявка покрыта ровно
     один раз», «у инженера не больше одного маршрута»; цели решаются по очереди
     (`unassigned_rank1..3` → `new_active_engineers` [→ `stability_units`] →
     `distance_m` → `soft_penalty`), решатель — HiGHS через `scipy.optimize.milp`;
     ответ решателя перепроверяется, при ухудшении — откат к прежнему плану;
   - **независимая проверка** `dispatch/validation.py: validate_plan`; если её вектор
     не совпал с `ev.key` — `RuntimeError`.
5. **Отчёт** — `dispatch/evaluate.py: Evaluator.report`: сводка, маршруты с расписанием
   (приезд/ожидание/начало/конец/дорога/запас), неназначенные с кодом причины.
   Бэкенд переводит отчёт в API (`backend/app/services/planner_service.py: build_api_result`).

**Вставка заявки** (`dispatch/search.py: repair`): на каждом шаге выбирается заявка с
высшим приоритетом; среди равных — по правилу стратегии; цена вставки — открытие нового
инженера (`fleet_weight`) плюс прирост метров; учитывается «сожаление» (regret —
насколько хуже 2–3-я альтернатива).

**Локальные улучшения** (`dispatch/search.py: local_descent`): три хода — перенос заявки
(в т.ч. к другому инженеру), разворот участка маршрута (2-opt), обмен хвостами (2-opt*).
Каждый ход перепроверяется целиком (`ev.route`).

## 3. Ограничения: как именно проверяются

| Ограничение | Как проверяется | Функция и файл |
|---|---|---|
| **Квалификация**: навык заявки входит в навыки инженера | уровень навыка = `skill_levels[skill]`, иначе 1, если `skill in skills`, иначе 0; условие `level >= task.min_skill_level`. Матрица допустимых пар `allowed[k,i]` строится из этой проверки и используется поиском | `routing_algorithm/beeline_optimizer_v2_final/dispatch/model.py: is_compatible`, `Arrays.build`; независимо — `dispatch/validation.py: constraint_violations` (коды `NO_SKILL`, `NO_SKILL_LEVEL`); на бэкенде при ручном переназначении — `backend/app/services/replan_engine.py: _constraint_checks` (ключ `skill`) |
| **Время**: время в пути + длительность укладываются в смену; начало работы попадает во временное окно | приезд = конец предыдущего визита + время в пути; `start = max(arrival, max(window_start, release_time))`; если `start > window_end` — недопустимо; `end = start + duration`; если `end > shift_end` — недопустимо | `dispatch/kernels.py: evaluate` (цикл по маршруту: `now = max(now, opening[idx])`, `if now > closing[idx]`, `if now > shift_end[k]`); расписание — `dispatch/evaluate.py: Evaluator.schedule`; независимо — `dispatch/validation.py: constraint_violations` (коды `WINDOW`, `SHIFT`); на бэкенде — `replan_engine.py: _constraint_checks` (ключ `time`) |
| **Ресурс**: требуемый тип транспорта есть у инженера | если у заявки задан `required_transport`, он должен совпасть с транспортом инженера; иначе ограничения нет | `dispatch/model.py: is_compatible` (`t.transport is None or t.transport == e.transport`), `Arrays.build` → `allowed`; независимо — `dispatch/validation.py: constraint_violations` (код `NO_TRANSPORT`); на бэкенде — `replan_engine.py: _constraint_checks` (ключ `transport`) |

Дополнительно `is_compatible` проверяет доступность инженера (`e.available`) и
оборудование (`set(t.required_tools).issubset(e.tools)`); валидатор помечает их кодами
`ENGINEER_UNAVAILABLE` и `NO_EQUIPMENT`.

## 4. Базовый вариант FIFO

`dispatch/evaluate.py: baseline(instance)`:

- маршруты начинаются с замороженных (`ev.a.locked`);
- заявки перебираются в порядке их индекса (порядок входа);
- для каждой заявки берётся **первый** инженер `k`, к которому заявку можно добавить
  **в конец** маршрута (`route + (i,)` проходит `ev.route`); иначе заявка остаётся
  без исполнителя;
- глобальная оптимизация не выполняется.

Бэкенд вызывает его через `backend/app/services/baseline_service.py: BaselineService.compute`
→ `algorithm_adapter.baseline_routes` → `dispatch.baseline`. В API базовый план доступен
через `POST /planning/baseline` и как стратегия `fifo` в `POST /planning/compare`.
Аналогичная обёртка — `dispatch/operations.py: baseline_fifo`.

## 5. Метрики

### Число уникальных задействованных инженеров
`dispatch/evaluate.py: Evaluator.key` считает `active = sum(bool(route) or e.used_today)`.
`Evaluator.report` кладёт это в `active_engineers_today`. Бэкенд читает поле в
`backend/app/services/metrics_service.py: metric_block_from_report` и `build_plan_summary`
(`engineers_used`). Факт: `used_today` бэкенд в `prepare_problem` не передаёт, поэтому
сейчас «задействован» = инженер с хотя бы одним визитом в маршруте.

### Пробег по каждому инженеру и суммарно
- По инженеру: `Evaluator.report` → `routes[].distance_km = route metres / 1000`;
  метры — сумма `distance[k, prev, node]` по рёбрам маршрута (`Arrays.distance`).
- Суммарно: `future_distance_km = key[4] / 1000` (сумма по всем маршрутам).
- Бэкенд: `metrics_service.metric_block_from_report` (`total_distance_km`),
  `strategy_service._column` (`km_total`, `km_by_engineer[{engineer_id, km, tasks}]`).
- Важно: `distance_km` берётся из **матриц**, а не из дорожной геометрии карты.

## 6. Как получены расстояния и время в пути

Матрицы строит `backend/app/services/geo.py: build_matrices`:

- **car** — локальный OSRM `/table` (`backend/app/services/local_osrm.py: LocalOsrmClient.table`),
  источник `local_osrm:car`; при сбое — облачный OpenRouteService (`ors_client.matrix`,
  `openrouteservice:<profile>`); крайний фолбэк — прямая с дорожным коэффициентом.
- **walk / bike / public_transport** — считаются математикой, без OSRM
  (`MATH_TRANSPORTS`): расстояние = гаверсинус × `MATH_ROAD_FACTOR` (1.3); время —
  `build_travel_matrix` (walk 4.5 км/ч, bike 14 км/ч) и `public_transport_minutes`
  (до 15 км — 18 км/ч + 10 мин ожидания, свыше — 35 км/ч + 15 мин). Источник
  `math:<transport>`.
- **Резервный расчёт** — гаверсинус × `road_factor` (по умолчанию 1.28,
  `backend/app/core/config.py`), время по `TRANSPORT_SPEED_KMH` (car 30, walk 5, bike 14,
  public 19 + `PUBLIC_TRANSPORT_PENALTY_MINUTES` 5), источник `straight_line_estimate`.

**Дорожная геометрия линий для карты** считается отдельно на чтении плана
(`backend/app/services/route_service.py: attach_route_geometry`, `enrich_geojson_geometry`)
через `OpenRouteServiceClient.route_geometry`. Порядок провайдеров
(`backend/app/services/ors_client.py`): машина и общественный транспорт — локальный OSRM →
ORS → FOSSGIS OSRM; пешком/велосипед — ORS → FOSSGIS (профили foot/bike) → локальный OSRM
(автограф) → посегментно. Метки: `local_osrm:car`, `openrouteservice:foot-walking+walk`,
`osrm:cycling-regular+bike`, `straight_line`.

## 7. Будущие доработки

- **Зоны заявок.** Импорт будет заполнять поле `zone` — тогда заработает мягкий штраф
  за переезды между зонами: модель его уже поддерживает, сейчас `soft_penalty = 0`.
- **Длительность по инженеру.** `algorithm_adapter.prepare_problem` будет передавать
  `service_by_engineer` — индивидуальную длительность работы для каждого инженера;
  сейчас используется общий `duration` заявки.
- **`used_today` в первичном плане.** Бэкенд будет передавать `used_today` в первичный
  план — модель это поле уже поддерживает.
- **ML-прогноз длительности и риска.** Модули `dispatch/ml.py`, `dispatch/ml_risk.py`,
  `dispatch/ml_integration.py` подключим к бэкенду, когда появится история фактических
  длительностей работ.
- **Точные режимы оптимизатора.** Column generation (`use_column_generation=True`)
  и точный режим `exact_small` уже реализованы и по умолчанию выключены; следующий шаг —
  включать их для небольших задач.
- **Разрыв до оптимума.** Эвристика (жадная вставка → ALNS → MILP-сборка из пула маршрутов)
  не гарантирует глобальный оптимум (`search.solve`, `meta['limitations']`); добавим
  нижнюю границу, чтобы показывать, насколько план далёк от оптимального.
