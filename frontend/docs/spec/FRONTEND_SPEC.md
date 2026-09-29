# ТЗ фронтенда — сервис планирования маршрутов инженеров

Прототип для оператора связи · **версия 2.7 от 29.09.2026** — финальные макеты всех ролей: диспетчер — `design/Dispatcher_Flow.html`, инженер — `design/Engineer.html`, оператор — `design/Operator.html` (§2.1).
Код пишем с нуля по готовым макетам. Бэк уже работает на `https://api.bee-dynasty.ru`.

**Что изменилось в v2.7 (29.09) — уточнения оператора связи об авариях (D-37, D-38):**
- авария — по HD «Авария», а не по BK «Глобальная проблема»: помощник `isEmergency` (§10.1), красный маркер `zap`, сокращения типа (§6.8, §8.2, §8.3.5);
- DS-06 «Срочная заявка» и вкладка оператора «Авария» — только HD «Авария», поле только для чтения (§6.4, §8.3.9); «Информацию» оператор записывает как обычную заявку (§8.3.7);
- DS-08: у бригады без заявок в текущем плане — метка «Не работает сегодня», её выбор — эскалация диспетчера (§6.7);
- правки бэка — `BACKEND_FIXES_FINAL_28-09.md` §13 (13.1–13.3).

**Что изменилось в v2.6 (28.09, ночь) — финальные макеты:**
- новый §2.1 — файлы финальных макетов, распаковка бандлов (`scripts/unpack-design.mjs`, `npm run design:unpack`), соответствие токенов, дизайн-система, что из макетов не переносить;
- §8.2 — таблица «Финальный макет диспетчера против ТЗ» (24 пункта: где прав ТЗ, что берём из макета, что дописано), D-36;
- флаги правок бэка — в `FEATURES` из `src/config.ts` этапа 01 вместо отдельного файла (§5.4); новый флаг `addEngineerAfterPublish` (бэк §12);
- §17 — этапы работ после каркаса (A…H) для всех ролей;
- имена файлов макетов: `Engineer.html`, `Operator.html` (без `.dc`).

**Что изменилось в v2.5 (28.09, ночь):**
- §8.3 «Оператор» — полное ТЗ внутри этого документа (было в отдельном `OPERATOR_SPEC.md` v1.0; по смыслу без изменений, D-33…D-35);
- новый §5.4 — флаги правок бэка и запасные пути для всех ролей, статус живой схемы на 28.09 01:20. **Ручек часов дня в схеме нет** — готовим запасной путь §7;
- новый §17 — план работ по инженеру и оператору поверх диспетчера;
- правки бэка — один файл `BACKEND_FIXES_FINAL_28-09.md`, номера ⏳ в тексте — оттуда;
- диспетчер (§6, §7, §8.2) и инженер (§9) по смыслу не менялись.

**Что изменилось в v2.4 (28.09, ночь):**
- оператор вынесен в отдельный документ `OPERATOR_SPEC.md` v1.0 (согласован по макету, D-33…D-35); §8.3 — ссылка на него;
- правки бэка по оператору — `BACKEND_FIXES_OPERATOR_28-09.md` (9.1–9.9), в том числе бывшие пункты бэклога §5 и §8;
- §1, §3, §4, §5.1–§5.3, §13, §14, §16 — под новый документ.

**Что изменилось в v2.3 (28.09):**
- §9 «Инженер» переписан по согласованному макету (D-30…D-32): подписи кнопок статуса, начать можно только текущую заявку, заявка после «Прервать» не остаётся текущей, экран E-03.1, меню ⋯, «Завершить смену», баннер только после решения диспетчера;
- «Инцидент» показываем, только если бэк добавит действие `incident`: в живой схеме 28.09 его нет;
- `EngineerVisit` выверен по живой схеме: без `lat` / `lon`; ⏳ `actual_start`, `actual_end`, `equipment`;
- правки бэка по инженеру — `BACKEND_FIXES_27-09.md` §8;
- §3, §4, §13, §14, §16 — под новый §9.

**Что изменилось в v2.2 (27.09, ночь):**
- новый §6.8: синтетические наборы `*.instance.json` — каких полей нет, что показываем вместо них, признак синтетики, условные координаты;
- часы таймлайна и конец окна срочной заявки берём из смен бригад, а не 10:00–22:00: в наборах смена 09:00–19:00 (§8.2, §10.3);
- подписи типа — по навыку, если нет `type_bk`; короткие id вида `T012` выводим целиком (§8.2, §10.1);
- шаг 0 снимает и синтетический сценарий (§12), правила проекта (§16).

**Что изменилось в v2.1 (27.09, вечер):**
- §8.2 «Диспетчер» переписан по согласованному макету (D-25…D-29);
- «Построить план» = расчёт + публикация, черновика у CSV-дня нет; дата CSV = сегодня;
- фильтры одиночные, фильтра по флагам нет; день — всегда один регион;
- часы дня во фронте только показываются (§7);
- сравнение: + «Начато в окне» и «Просрочено», заполнение до плана; лента, версии, переназначение — по макету (§6.3–§6.7).

**Что изменилось в v2.0 относительно v1:**
- типы и ручки выверены по живой схеме `https://api.bee-dynasty.ru/openapi.json` (27.09);
- добавлены адаптеры и обходы для мест, где API расходится с макетами (§6);
- добавлены «Часы дня» (D-24): демо-время дня на сервере, по умолчанию реальное (§7);
- добавлен шаг 0 — снимок живых ответов API (§12).

**Смежные документы:**
- `design/Dispatcher_Flow.html` — **согласованный макет диспетчера** (источник правды по его виду).
- `design/Engineer.html` — **согласованный макет инженера** (E-01, E-02, E-03, E-03.1, E-03.2, E-03.3, E-04, E-06…E-10).
- `design/Operator.html` — **согласованный макет оператора** (O-02, O-01 обычная заявка и авария, O-01.2); поведение — §8.3.
- `DESIGN_SPEC.md` + папка `design/` — вёрстка входа (S-01) и общие компоненты. **Дизайн заморожен.**
- `UI_KIT_tokens.md` — стиль.
- `FRONTEND_AGENT_GUIDE.md` (от бэка) и Swagger `https://api.bee-dynasty.ru/docs` — API.
- `BACKEND_FIXES_FINAL_28-09.md` — итоговый список правок бэка (§1–§12); номера ⏳ в этом ТЗ — оттуда.
- `DECISIONS.md` (D-01…D-38).
- `ENGINEER_SPEC_REVIEW_28-09.md`, `OPERATOR_SPEC_REVIEW_28-09.md` — сверки макетов инженера и оператора с ТЗ.
- `*.instance.json`, `demo_30.json` — синтетические наборы алгоритма (§6.8).

**Метки:**
- [Д] — допущение;
- ⏳ — зависит от правки бэка из `BACKEND_FIXES_FINAL_28-09.md`; флаг и запасной путь — §5.4;
- **P0** — видео и сдача 29.09; **P1** — если успеваем до 28.09 18:00.

---

## 1. Что строим
Одно React-приложение, три роли. Роль и регион приходят с бэка после входа.

| Роль | Устройство | Главное |
|---|---|---|
| Диспетчер (`dispatcher`) | десктоп ≥ 1280 | календарь заявок → день «Карта / Таймлайн» → объяснение, события, предложение с diff, сравнение наш / FIFO / реальный |
| Оператор (`operator`) | десктоп | поиск заявки → отмена или перенос; запись в 2 шага (поля → дата и окно); авария → диспетчеру (§8.3) |
| Инженер (`engineer`) | телефон, 360–430 px | свой маршрут, статусы, «Прервать», карта, ссылка в Яндекс Карты |

**Правила, которые влияют на код:**
1. **Изменения назначений принимает диспетчер.**
   - События дня отправляем с `apply: false`, бэк возвращает `proposed`; диспетчер нажимает «Принять» или «Отклонить».
   - Факты инженера («В пути», «В работе», «Выполнена») бэк применяет сразу.
   - Запись оператора бэк встраивает в план сам (D-18).
   - «Построить план» в CSV-дне сразу публикует план (D-25).
2. **«Сейчас» — это часы дня** (D-24, D-28):
   - если у дня заданы часы (`clock`), все «сейчас» берутся из них;
   - если нет — реальное время Europe/Moscow;
   - во фронте часы только показываются, переводит их бэк.
3. **Три ограничения** везде называются одинаково: «Квалификация», «Время», «Ресурс».
4. **Сравнение** всегда в 3 колонках: наш / базовый FIFO / реальный диспетчер.

---

## 2. Стек
| Что | Выбор |
|---|---|
| Сборка | Vite + React 18 + TypeScript (strict) |
| Роутинг | react-router 6 |
| Серверное состояние | @tanstack/react-query 5 |
| Карта | leaflet + react-leaflet 4, тайлы OSM |
| Даты | date-fns + локаль `ru` |
| Иконки | lucide-react |
| Стили | CSS Modules + `src/styles/tokens.css` (из `UI_KIT_tokens.md` и `DESIGN_SPEC` §2) |
| Типы API | `openapi-typescript` → `src/api/schema.d.ts` из живой схемы (§5.2) |
| Моки | msw 2 на фикстурах из снимка API (§12) |
| Качество | eslint + prettier + `tsc --noEmit` |

**Dev-прокси:** в `vite.config.ts` `server.proxy['/api'] → https://api.bee-dynasty.ru` (`changeOrigin: true`), поэтому при разработке CORS не нужен. В проде — `VITE_API_URL` и CORS на бэке ⏳.

Не берём: Redux, UI-киты (MUI и т. п.), готовые календари и Gantt. Календарь месяца и таймлайн — свои, на CSS Grid.

### 2.1. Макеты: файлы, распаковка, токены, компоненты
**Финальные макеты (28.09).** Вёрстку берём только отсюда:

| Роль | Файл в репозитории | Экраны |
|---|---|---|
| Диспетчер | `design/Dispatcher_Flow.html` + вложенные страницы `DispatcherCalendar.dc.html`, `DispatcherDay.dc.html` | S-01, DS-01…DS-10, вкладки правой панели «Сравнение», «Неназначенные», «Лента», «Версии» |
| Инженер | `design/Engineer.html` | E-01, E-02, E-03, E-03.1…E-03.3, E-04, E-06…E-10 |
| Оператор | `design/Operator.html` | O-02, O-01 (обычная заявка и авария), O-01.2 (выбор окна, успех, «окно заняли») |

**Как читать.** Файлы — HTML-бандлы макетов: разметка и ресурсы лежат внутри в base64 + gzip, поэтому напрямую их не прочитать.
- Распаковка: `npm run design:unpack` → `node scripts/unpack-design.mjs design/<файл>.html` для каждого из трёх файлов.
- Результат — в `design/_unpacked/<имя>/` (папка в `.gitignore`):
  - `index.html` — разметка;
  - `pages/*.html` — вложенные страницы;
  - `assets/` — логотип, шрифты, скрипты;
  - `MANIFEST.md` — список файлов.
- **Разметка — формат x-dc:**
  - HTML-шаблон с `{{ … }}`, `<sc-for>`, `<sc-if>`;
  - компоненты дизайн-системы — `<x-import component-from-global-scope="DS_4fbbd1.Button" …>`;
  - вложенная страница — `<dc-import name="DispatcherDay" state="csv|published|live" view="map|timeline" tab="…">`: это `pages/DispatcherDay.dc.html` в нужном состоянии; ссылки внутри страниц на `_ds/…/_ds_bundle.js` и `support.js` — тот же бандл дизайн-системы из `assets/`;
  - данные и тексты экранов — в `renderVals()` внутри `<script type="text/x-dc">` в конце файла;
  - стили — inline и CSS-переменные.
- **Дизайн-система** — файл `assets/<uuid>.js`, который начинается с `/* @ds-bundle … "namespace":"DS_4fbbd1"`. Это исходник компонентов: Button, IconButton, Icon (lucide), StatusChip, UrgentFlag, SegmentedControl, Select, Switch, Radio, Checkbox, Input / Field, Table, Drawer / Dialog, Popover / Tooltip, Toast, Card, Metric, EngineerAvatar, RouteMarker, TimeSlotPicker, Timeline, MapView.
  - По нему повторяем варианты, размеры и состояния `ui/*`, но пишем свой код на CSS Modules и токенах `tokens.css`, React-код как есть не копируем.

**Из макетов берём:** раскладку, размеры, отступы, иконки (имена lucide), тексты-шаблоны, состояния экранов.

**Не берём:**
- **Демо-данные:** имена, номера заявок, км, время, даты, «Ирина Ковалёва», «Алексей Гончаров», «Все бригады · 12», «1 314 заявок за месяц».
- **Зашитые значения:** ось 10–22, «смена 10–22», «ОКНО 18–20» в шаблоне.
- **Подписи-заглушки** «пример» и «цифры — пример».
- **Служебное из макетов:** навигацию между макетами и остатки в `renderVals`, которые не выведены на экран: `fileMsgs`, `evOptsP1` («Транспорт», «Задержка»), `trPick`, `dayBoards`, `secs`, `hintNow`, `retry`.
- **`TASK_STATUS` из дизайн-системы:** там другая модель статусов. Статусы и флаги — только из `lib/statuses.ts`.
- **Компоненты `DispatcherApp`, `EngineerApp`, `OperatorApp` из бандла** — это черновые примеры дизайн-системы, по ним не верстаем.

**Токены.** Макеты используют имена дизайн-системы, в коде — `styles/tokens.css` из этапа 01. Значения совпадают, имена разные. При переносе стилей меняем имена по таблице:

| В макете | В `tokens.css` |
|---|---|
| `--bg-nested` · `--bg-control-track` | `--bg-surface-nested` · `--bg-control` |
| `--text-on-inverse` · `--text-on-accent` | `--on-inverse` · `--on-accent` |
| `--status-{success,info,warning,danger,changed,neutral}` и `…-bg` | `--st-{…}` и `--st-{…}-bg` |
| `--radius-field` · `--radius-overlay` · `--radius-inner` | `--radius-md` · `--radius-lg` · `--radius-sm` |
| `--shadow-popover` | `--shadow-float` |
| `--font-sans` | `--font` |
| `--focus-ring` (outline 3 px) | наш `--focus-ring` (кольцо через `box-shadow`, `DESIGN_SPEC` §2.3) [Д] |

**Добавить в `tokens.css`** со значениями из макета (в `:root` любого из трёх файлов):
- `--accent-hover`, `--accent-press`;
- `--line-subtle`, `--line-strong`;
- `--flag-urgent-bg`, `--flag-urgent-text`;
- `--route-1` … `--route-12`;
- `--font-metric`, `--font-h1`, `--font-h2`, `--font-h3`, `--font-body`, `--font-body-medium`, `--font-caption`, `--font-caption-medium`, `--font-axis`;
- `--control-h-sm / md / lg`, `--hit-min`, `--shadow-drawer`, `--icon-sm / md / lg`;
- `--ease-standard`, `--dur-fast / base / slow`;
- `--map-route-width`, `--map-marker-size`, `--map-marker-stroke`.

HEX вне `tokens.css` по-прежнему запрещены.

---

## 3. Структура
```
scripts/          snapshot-api.mjs (§12), unpack-design.mjs (§2.1), gen-types.sh
design/           Dispatcher_Flow.html, Engineer.html, Operator.html; _unpacked/ — распаковка, в .gitignore (§2.1)
docs/api-examples/  снимки живых ответов (*.json) — источник для адаптеров и моков
src/
  config.ts       API_URL, USE_MOCKS, POLL, TZ, FEATURES (§5.4) — из этапа 01
  app/            router.tsx, providers.tsx, RequireRole.tsx, AppBar.tsx
  api/            client.ts, errors.ts, schema.d.ts (генерируется), types.ts (ручные типы для «obj»-ответов),
                  queryKeys.ts, auth.ts, calendar.ts, days.ts, data.ts, planning.ts, events.ts,
                  booking.ts, engineer.ts, visualization.ts, clock.ts
  adapters/       dayModel.ts, constraints.ts, compare.ts, proposal.ts, feed.ts, geo.ts, normalize.ts
  mocks/          browser.ts, handlers.ts (фикстуры = docs/api-examples)
  styles/         tokens.css, globals.css
  ui/             Button, SegmentedControl, FilterBar, StatusChip, FlagChip, Chip, Popover, Drawer, Modal,
                  BottomSheet, Toast, Banner, Field (Input, Select, DatePicker, TimePicker, Textarea,
                  Toggle, RadioPills, Dropzone), EmptyState, Skeleton, ErrorState, Tabs
  lib/            time.ts, format.ts, statuses.ts, dictionaries.ts, colors.ts, yandexMaps.ts, explainTexts.ts,
                  engineerLabels.ts, booking.ts
  features/
    auth/         LoginPage
    dispatcher/
      calendar/   CalendarPage, MonthGrid, CalendarCell
      import/     ImportModal
      day/        DayPage, DayHeader, DayMenu (⋯), ProposalBanner, EngineerChips
        map/      DayMap, VisitMarker, RouteLayer, MapLegend
        timeline/ DayTimeline, EngineerRow, VisitBlock, NowLine, TimeAxis
        panel/    RightPanel, CompareTab, UnassignedTab, FeedTab, VersionsTab
      request/    RequestDrawer, ExplanationBlock
      events/     EventModal, ProposalDrawer, DiffList, DecisionCard
      reassign/   ReassignModal
      roster/     RosterDrawer
      summary/    CompareModal, DaySummaryModal
    operator/     OperatorLayout, search/*, booking/*, reschedule/* — состав в §8.3.2
    engineer/     EngineerApp, EngineerMenu, PreviewScreen, TransportSheet, VisitList, ActiveVisitCard,
                  StatusPanel, WaitingRow, CompletedBlock, DoneToast, VisitCardPage, EngineerMap,
                  InterruptSheet, IncidentSheet, UnavailableSheet, ShiftEndConfirm,
                  PlanChangedBanner, ShiftSummary
design/           экспорт макетов — эталон вёрстки
```

---

## 4. Роуты и состояние в URL
Фильтры и открытые панели держим в query-параметрах. В каркасе этапа 01 у оператора были заглушки `/operator` = O-01 и `/operator/search` = O-02 — заменить на роуты ниже.

| Путь | Экран | Параметры |
|---|---|---|
| `/login` | S-01 | — |
| `/` | редирект по роли из `GET /auth/me` | — |
| `/dispatcher` | DS-01 Календарь | `month=2026-09`, `region=all\|east\|south_east\|south_center` (по умолчанию `all`), `status`, `type` — по одному значению; `modal=import` (DS-02) |
| `/dispatcher/day/:date` | DS-03 День | `region` (один регион), `status`, `type`, `view=map\|timeline`, `tab=compare\|unassigned\|feed\|versions`, `engineer=<id>`, `request=<id>` (DS-04), `proposal=<plan_id>` (DS-07), `modal=event\|reassign\|roster\|compare\|summary` (+ `event_type`, `order`) |
| `/operator` | O-02 Найти заявку | `q`, `request=<id>`, `cancel=1` |
| `/operator/new` | O-01 → O-01.2 | `tab=regular\|emergency` |
| `/operator/reschedule/:id` | O-02.1 Перенос | — (§8.3.3) |
| `/engineer` | E-01 / E-03 / E-04 / E-10 — по состоянию дня (§9) | `view=list\|map`, `sheet=transport\|interrupt\|incident\|unavailable` (E-02, E-06, E-07, E-08) |
| `/engineer/request/:id` | E-03.1 / E-05 Карточка заявки | `sheet=interrupt\|incident` (для текущей) |

- `RequireRole` пускает только свою роль.
- 401 → сброс токена и переход на `/login`.
- 403 → тост «Нет доступа к этому разделу» и редирект на главный экран роли.

---

## 5. API

### 5.1. Клиент (`api/client.ts`, `api/errors.ts`)
- **База:** `import.meta.env.VITE_API_URL ?? '/api/v1'`. Во время разработки — через прокси Vite.
- **Токен:** `Authorization: Bearer <access_token>`, хранится в `localStorage.auth_token`. Срок жизни — 21 день.
- **Ошибки.** У бэка три формата. `toApiError` сводит их в один `ApiError {status, code, message, details}`:
```ts
export function toApiError(status: number, body: any): ApiError {
  const e = body?.error ?? body?.detail?.error;                    // middleware | HTTPException
  if (e) return new ApiError(status, e.code, e.message, e.details);
  if (typeof body?.detail === 'string')                            // 422 ErrorResponse {detail, code, context}
    return new ApiError(status, body.code ?? 'VALIDATION_ERROR', body.detail, body.context);
  if (Array.isArray(body?.detail))                                 // 422 FastAPI HTTPValidationError
    return new ApiError(status, 'VALIDATION_ERROR', 'Проверьте заполнение полей', body.detail);
  return new ApiError(status, 'UNKNOWN', 'Не удалось выполнить запрос. Повторите');
}
```
- **Коды с особой реакцией:** `UNAUTHORIZED`, `FORBIDDEN`, `STALE_PROPOSAL`, `ILLEGAL_TRANSITION`, `COMMENT_REQUIRED`, `DUPLICATE_REQUEST`, `DATE_HAS_BOOKINGS`, `SLOT_TAKEN`, `BAD_CSV`, `ROWS_MISMATCH`, `REGION_UNKNOWN`, ⏳ `CLOCK_BACKWARD`.
- **Идентификатор заявки** в событиях и переназначении шлём как **`order_id`**: в схеме `request_id` помечен как устаревший алиас. Во всех остальных ручках — `request_id`, как в пути.
- **Опрос вместо вебсокетов:**

| Что | Интервал |
|---|---|
| День диспетчера (`/days`, план, лента) | 10 с |
| Экран инженера | 15 с |
| Календарь | 30 с |
| Окна оператора | фоном на шаге 1 (debounce 300 мс); на шаге «Дата и окно» — при смене даты и каждые 30 с (§8.3.4) |

  Опрос выключаем, когда вкладка скрыта: `refetchIntervalInBackground: false`.

### 5.2. Типы
1. **Генерация из живой схемы:** `npx openapi-typescript https://api.bee-dynasty.ru/openapi.json -o src/api/schema.d.ts` (скрипт `npm run gen:types`). Это источник правды для типизированных ответов. Ручные интерфейсы заводим только поверх `components['schemas'][...]`.
2. **Ответы без схемы** (в схеме тип «объект»): `/calendar`, `/days/{date}`, `/planning/{id}/requests/{rid}`, `/engineers/me/day`, `/engineers/me/route`, `GET /booking/requests`, ответы `cancel` / `reschedule`, `CompareResponse.columns` и `km_by_engineer`, `ReplanResult.applied_event`, `EventItem.payload`, `ReassignCheckResponse.checks`, `ExplanationOut.local_alternatives` / `schedule`.
   - Типы для них — в `api/types.ts` по гайду бэка.
   - Уточнить по снимкам `docs/api-examples/*.json` (§12).
   - В адаптерах для этих данных — только безопасный доступ (`?.`, значения по умолчанию).

**Главные схемы — кратко, по живой схеме 27.09:**
```ts
// PlanResponse
{ plan_id, scenario_id, parent_plan_id?, kind, status: 'draft'|'proposed'|'applied'|'rejected'|'superseded',
  version /*0 = черновик*/, strategy, event_id?, created_at,
  summary: { engineers_used, total_distance_km, planned_count, total_requests, unassigned_count, unassigned_urgent, objective[], elapsed_seconds? },
  metrics?: { optimized: MetricBlock, baseline: MetricBlock, engineers_saved, distance_saved_km, distance_saved_percent, extra_requests_planned },
  routes: RouteOut[], assignments: AssignmentOut[], unassigned: UnassignedOut[], explanations: ExplanationOut[],
  changes: object[], violations: object[], map_geojson?, algorithm_metadata }
// MetricBlock
{ engineers_used, total_distance_km, planned_count, total_requests, unassigned_count, unassigned_urgent }
// RouteOut
{ engineer_id, engineer_name, transport, transport_display, skills[], skills_display[], shift_start, shift_end,
  start_latitude?, start_longitude?, distance_km, task_count, route: RoutePoint[], geometry?: number[][], geometry_source?, explanation }
// RoutePoint
{ request_id, sequence, latitude, longitude, address?, arrival, start, end, travel_minutes, leg_distance_km, waiting_minutes,
  window_start, window_end, required_skill, required_skill_display, status, flags[], slack_minutes?, frozen,
  actual_arrival?, actual_start?, actual_end? }
// UnassignedOut
{ request_id, reason_code, reason, proven_static }
// ExplanationOut
{ request_id, status: 'assigned'|'unassigned', engineer_id?, engineer_name?, summary, reasons: string[], schedule?: object, local_alternatives: object[] }
// ScenarioOut — отсюда поля заявки и инженеров для карточек
{ scenario_id, name, region_id?, date?, source?, office?, active_plan_id?, draft_plan_id?, clock?, engineers: EngineerOut[], requests: RequestOut[] }
// RequestOut
{ id, latitude, longitude, address?, duration_minutes, window_start, window_end, priority, required_skill, required_skill_display,
  required_transport?, required_transport_display?, dispatcher_engineer_id?, external_id?, type_bk?, type_hd?, district?,
  gigabit, technology?, priority_rank, source, client_window_locked, status, flags[] }
// EngineerOut
{ id, name, latitude, longitude, shift_start, shift_end, skills[], skills_display[], transport, transport_display, available,
  start_kind, available_until?, shift_status, actual_transport?, assigned_tasks, distance_km }
// CompareResponse
{ region_id?, columns: { ours?: CompareColumn, fifo?: CompareColumn, dispatcher?: CompareColumn }, km_by_engineer: object, notes: string[] }
// CompareColumn
{ engineers_used, km_total, coverage_pct, unassigned_urgent, violations, km_is_estimate }
// ApplyEventRequest
{ type, plan_id?, event_time?, source?, order_id?, engineer_id?, request?: RequestIn, params?: object, apply?: boolean }
// RequestIn — обязательные: id, duration_minutes, window_start, window_end, required_skill
{ id, latitude?, longitude?, address?, duration_minutes, window_start, window_end, priority, required_skill, required_transport?,
  type_bk?, type_hd?, district?, gigabit?, technology?, source? }
// ReplanResult
{ event_id, event_type, previous_plan_id, status: 'applied'|'proposed', plan: PlanResponse, changes: object[], change_summary: object,
  applied_event: object, scenario: object, violations: object[] }
// PlanDiffResponse
{ base_plan_id, new_plan_id, summary: { reassigned, reordered, time_shifted, added, removed, newly_unassigned, newly_assigned, untouched },
  changes: object[], engineers: { engineer_id, km_before, km_after, route_changed }[], metrics_before, metrics_after, headline }
// PlanVersionResponse
{ plan_id, status, active_plan_id? }
// EventItem
{ event_id, event_type, plan_id?, scenario_id?, result_plan_id?, payload: object, needs_decision, created_at }
// ReassignRequest
{ plan_id?, order_id, to_engineer_id, position?, force? }
// ReassignCheckResponse
{ order_id, to_engineer_id, feasible, checks: object, new_start?, shifted_visits[], late_visits[], delta_km }
// BookingSlotsResponse
{ region_id, date, required_skill, duration_minutes, required_transport?, slots: { window, available, reason_code?, reason? }[] }
// BookingRequestIn
{ region_id, date, window, type_bk, type_hd?, address, district?, gigabit?, technology?, required_transport?, client_contact? }
// BookingRequestOut
{ request_id, scenario_id, status, tentative_engineer_id?, plan_id?, window }
// EngineerActionIn — в схеме 28.09 action: shift_start|en_route|start|complete|fail|delay|unavailable|shift_end
{ action: 'shift_start'|'en_route'|'start'|'complete'|'fail'|'delay'|'unavailable'|'shift_end' (+ ⏳ 'incident'), request_id?, at?, payload? }
// EngineerActionOut
{ engineer_id, action, status, event_id?, request_id?, day? }
// EngineerVisit — по живой схеме 28.09: координат, окончания и фактов нет
{ request_id, sequence, status, flags[], type_bk?, type_hd?, address?, district?, window /*"10:00-12:00"*/, arrival?, start?,
  duration_minutes, leg_km, gigabit, technology?, why_you,
  actual_start? /* ⏳ */, actual_end? /* ⏳ */, equipment? /* ⏳ P2: {вид: количество} */ }
// UserOut
{ id, login, name, role, region_ids[], engineer_id? }
// RegionOut
{ region_id, name, office: { address, lat, lon }, request_count, engineer_count, demo_available, has_control }
```

**Ручные типы для ответов без схемы** (`api/types.ts`, по гайду — сверить со снимками):
```ts
export interface CalendarResponse { days: { date: string; request_count: number;
  by_status: Partial<Record<RequestStatus, number>>; flags: Partial<Record<Flag, number>>; sources: string[] }[] }
export interface DayRegion { region_id: RegionId; name: string; scenario_id: string; source: string; office: OfficeOut;
  active_plan_id: string | null; draft_plan_id: string | null; plan_state: 'none' | 'draft' | 'applied'; version: number;
  pending_proposals: { plan_id: string; event_id?: string; headline: string }[];
  last_recalc?: { at: string; request_id: string } | null;
  clock?: string | null /* ⏳ D-24 */ }
export interface DayResponse { date: string; regions: DayRegion[] }
export interface EngineerMeDay { date: string; plan_published: boolean; clock?: string | null /* ⏳ */;
  engineer: { id: string; name: string; transport: Transport; actual_transport?: Transport | null; shift_start: string;
              shift_end: string; shift_status: ShiftStatus; available_until?: string | null;
              start?: { kind: string; address?: string; lat?: number; lon?: number };
              color_index?: number /* ⏳ P2 */ };
  summary: { total: number; done: number; km_planned?: number; first_start?: string | null };
  active_request_id?: string | null; visits: EngineerVisit[];
  banners: { type: string; text: string; at?: string; request_id?: string }[];
  shift_totals?: { done: number; total: number; started_in_window: number; km: number;
                   minutes_travel: number; minutes_work: number; minutes_wait: number; interrupted: number;
                   started_at?: string; ended_at?: string /* ⏳ */ } }
export interface EngineerRoute { transport: Transport; start: { lat: number; lon: number; label: string };
  points: { request_id: string; sequence: number; lat: number; lon: number; address?: string }[];
  geometry: { type: 'LineString'; coordinates: [number, number][] } }   // [lon, lat]
// BookingSearchItem, BookingCancelBody, BookingMutationResult — §8.3.4 (с полями ⏳ 9.2–9.4)
```

### 5.3. Экран → ручка
| Экран / действие | Ручка | Примечание |
|---|---|---|
| Вход | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | демо-учётки — в README, пароль в `.env.local`, в код не кладём |
| DS-01 Календарь | `GET /calendar?from&to&region_id&status&type_bk` | по одному значению фильтра; фильтра по флагам нет (D-27) |
| DS-02 Импорт | `GET /regions` (число бригад) · `POST /data/import-beeline` (multipart: `requests_file`, `control_file?`, `region_id`, `date = todayMsk()`) | параллельно по регионам |
| DS-03 Шапка дня | `GET /days/{date}?region_id` | `plan_state`, `version`, `pending_proposals`, ⏳ `clock` |
| DS-03 Данные региона | `GET /data/scenarios/{scenario_id}` + `GET /planning/{active_plan_id ?? draft_plan_id}` (если есть) | склейка — §6.1 |
| DS-03 Карта | `GET /visualization/{plan_id}/geojson?geometry=road` | §6.6; до плана — точки из `ScenarioOut.requests` |
| DS-03 «Построить план» | `POST /planning/run {scenario_id, seed: 42, include_baseline: true}` → сразу `POST /planning/{plan_id}/apply` | D-25 |
| DS-03 «Начать рабочий день» | `POST /planning/{draft_plan_id}/apply` | только день из записей оператора |
| DS-03 «Сравнение», DS-05 | `POST /planning/compare {plan_id \| scenario_id, strategies}` + `POST /planning/baseline {plan_id}` | §6.3 |
| DS-03 «Лента» | `GET /events?scenario_id&limit=50` | §6.5 |
| DS-03 «Версии» | `GET /planning?scenario_id` | §8.2, ⏳ `version` и заголовок |
| DS-04 Карточка | данные из §6.1 + `plan.explanations` | только назначенные заявки (D-29) |
| DS-06 Событие | `POST /events/apply {apply: false, …}` | 3 события — §6.4 |
| DS-07 Предложение | `GET /planning/{new}/diff?against={previous_plan_id}` → `/apply` \| `/reject` | §6.4 |
| DS-08 Переназначение | `POST /planning/{id}/reassign/check` (кандидаты параллельно) → `/reassign` → `/apply` | §6.7 |
| DS-09 Состав | `GET /data/scenarios/{id}/engineers`; до публикации — `PATCH …/{engineer_id}`, `POST …/engineers`; после — `POST /events/apply` (`transport_changed`, `engineer_unavailable`, `engineer_available`); `POST /planning/{id}/extend-resource` | §8.2 |
| DS-10 Итоги | активный план + `compare` + `baseline` + `events` | §8.2 |
| O-02 Поиск, отмена | `GET /booking/requests?q`, `POST /booking/requests/{id}/cancel {reason, comment?}` | §8.3.6 |
| O-01, O-01.2 Запись | `GET /booking/slots` → `POST /booking/requests` | §8.3.7–§8.3.8 |
| O-02.1 Перенос | `GET /booking/slots` → `POST /booking/requests/{id}/reschedule {new_date, new_window}` | §8.3.10 |
| O-01 «Авария» | `POST /events/apply {type: 'urgent_order_added', source: 'operator', apply: false, params: {region_id, comment}, request}` | §8.3.9, ⏳ 9.1 |
| E-01…E-10 | `GET /engineers/me/day`, `GET /engineers/me/route?remaining=true`, `POST /engineers/me/actions` | §9 |

После каждой мутации инвалидируем `['days', date]`, `['plan', id]`, `['scenario', id]`, `['events', scenarioId]`, `['calendar', month]`, `['engineerDay']`.

### 5.4. Правки бэка: флаги и запасные пути (`FEATURES` в `src/config.ts`) · P0
Номера — из `BACKEND_FIXES_FINAL_28-09.md`. Там же у Вани столбец «Готово».

**Правило:**
- **Флаг** — только там, где без правки кнопка или запрос упадут. Ставим руками после ответа Вани или проверки Swagger (`/docs`). По умолчанию `false`.
- **Поле** — если правка только добавляет поле, флаг не нужен: читаем, если пришло (`?.`), иначе запасной путь.

```ts
// src/config.ts — объект FEATURES из этапа 01; calendarMultiFilter убрать (D-27). Меняем руками, один флаг на правку
export const FEATURES = {
  dayClock: false,               // §1  ручки /data/scenarios/{id}/clock, clock в /days и /me/day
  failOther: false,              // 8.3 fail.reason 'other' + comment
  engineerIncident: false,       // 8.4 action 'incident' (есть в enum EngineerActionIn.action в /openapi.json)
  unavailableBeforeShift: false, // 8.5 unavailable при shift_status = not_started
  emergencyByRegion: false,      // 9.1 авария оператора по params.region_id
  cancelComment: false,          // 9.3 comment в отмене оператора
  addEngineerAfterPublish: false, // §12 добавить инженера в начатый день → engineer_available → предложение
} as const;
```

| # | Роль | Флаг или поле | В схеме 28.09, 01:20 | Если нет |
|---|---|---|---|---|
| §1 | день | `dayClock`; поле `clock` | ❌ ручек `/clock` нет | «сейчас» — реальное время; для видео — `?clock=HH:MM` в адресе дня диспетчера (§7). **P0, срок Вани — 12:00** |
| §2 | диспетчер | поля ленты `headline`, `source`, `event_time` | ✅ `needs_decision`, остальное — по снимку | шаблоны `DESIGN_SPEC` §7.3 (§6.5) |
| §3 | диспетчер | контракт `params`, геокодинг аварии | — | адрес аварии — подсказки из заявок дня (§6.4) |
| §4 | диспетчер | `version`, `headline` в `GET /planning` | ❌ | номер по порядку, заголовок из ленты («Версии», §8.2) |
| §5 | диспетчер | новые поля `CompareColumn`, сравнение до плана | ❌ | считаем сами (§6.3); до плана при ошибке — «—» |
| §6 | диспетчер | `cancel_reason`, `rescheduled_to` | — | подписи в DS-10 не показываем |
| §7 | диспетчер | `cost.engineers_needed` и др. | — | плашку в DS-09 не показываем |
| 8.1 | инженер | `banners[]` | по снимку | баннера E-09 нет, видно только флаг «Изменено» |
| 8.2 | инженер | сброс `active_request_id` после `fail` (поведение) | проверить на стенде | в видео после «Прервать» не нажимаем «Отправиться в путь» |
| 8.3 | инженер | `failOther` | не проверить: `payload` свободный | строку «Другое» в E-06 скрываем |
| 8.4 | инженер | `engineerIncident` | ❌ нет в enum | кнопку «Инцидент» скрываем, «Прервать» на всю ширину |
| 8.5 | инженер | `unavailableBeforeShift` | не проверить | «Не выйду сегодня» в E-01 скрываем |
| 8.6 | инженер | `actual_start`, `actual_end` в визите | ❌ | тост после выполнения без времени |
| 8.7 | инженер | поля `/me/day`, `shift_totals.started_at / ended_at` | по снимку | E-10: «Выполнено» и «Прервано» по визитам, остальное «—» |
| 8.8 | инженер | `equipment` в визите | ❌ | строки «Оборудование» нет |
| 8.9 | инженер | `engineer.color_index` | — | цвет `--route-1` у всех |
| 9.1 | оператор | `emergencyByRegion` | не проверить | вкладку «Авария» скрываем, аварию вводит диспетчер |
| 9.2 | оператор | `district`, `gigabit`, `technology`, `required_transport`, `engineer_name` в поиске | по снимку | строки «Район», «Гигабит», «Инженер» не выводим |
| 9.3 | оператор | `cancelComment` | ❌ | «Другое» в отмене не показываем |
| 9.4 | оператор | `message` в ответах записи, отмены, переноса | ❌ схемы нет | тексты §8.3.11 по дате заявки |
| 9.5 | оператор | `error.details.slots` при `SLOT_TAKEN` | — | `refetch()` окон |
| 9.7 | оператор | `district` в `/booking/slots` | — | район не подставляем и не шлём |
| 9.9 | оператор | `message` в 409 `ILLEGAL_TRANSITION` | — | тост «Не удалось выполнить запрос. Повторите» |
| §10 | все | CORS | — | прод-сборка не ходит в API; в dev — прокси Vite |
| 13.1 | все | авария по HD: `priority`, флаг `urgent`, `reaction_late` | ❌ на 29.09 | маркер и подписи фронт уже ставит по HD; чип «Срочная» у 5 «Информаций» Востока останется, пока бэк не поправит |
| 13.2 | диспетчер | `engineer_idle_today` в `reassign/check` | — | метку «Не работает сегодня» считаем по 0 заявок у бригады в текущем плане |
| §12 | диспетчер | `addEngineerAfterPublish` | не проверить | после публикации строки «+ Добавить инженера» в DS-09 нет (§8.2, таблица финального макета, п. 4) |

---


## 6. Адаптеры: где API расходится с макетами
Все обходы живут в `src/adapters/*` и покрываются юнит-тестами на фикстурах из `docs/api-examples`. Компоненты работают только с моделями адаптеров, а не с сырым API.

### 6.1. `dayModel.ts` — склейка плана, заявок и инженеров
В точке маршрута (`RoutePoint`) нет типа BK/HD, района, гигабита, технологии и требуемого транспорта. Поэтому на регион и день загружаем **`ScenarioOut`** один раз и строим:
```ts
type DayModel = {
  scenario: ScenarioOut; plan: PlanResponse;
  requests: Map<string, RequestOut>;          // по id
  engineers: Map<string, EngineerOut>;        // по id
  visits: Map<string, { point: RoutePoint; route: RouteOut }>;   // заявка → визит
  unassigned: Map<string, UnassignedOut>;
  explanations: Map<string, ExplanationOut>;
  engineerColor: Map<string, string>;         // §10.2
};
```
- Статус и флаги заявки: для назначенной — из `RoutePoint`, для остальных — из `RequestOut`.
- Стартовая точка инженера: `RouteOut.start_latitude/longitude`, иначе `EngineerOut.latitude/longitude`.
- До сборки модели данные проходят через `normalize.ts` (§6.8). В `DayModel` добавляются `synthetic: boolean` и `coordsApprox: boolean`, у заявок и бригад — готовые подписи (`label`, `typeShort`, `typeFull`, `addressText`).

### 6.2. `constraints.ts` — три ограничения в карточке заявки
В `ExplanationOut` нет разбивки по ограничениям: есть `summary` и `reasons[]` строками. Три строки «Квалификация / Время / Ресурс» **строим из фактов плана**. Это отображение, а не повторная проверка.
```ts
export function constraintRows(p: RoutePoint, r: RequestOut, e: EngineerOut): ConstraintRow[] {
  const eff = e.actual_transport ?? e.transport;
  const inWindow = toMin(p.start) >= toMin(p.window_start) && toMin(p.start) <= toMin(p.window_end);
  const inShift  = toMin(p.end) <= toMin(e.shift_end);
  return [
    { key: 'skill', label: 'Квалификация', ok: e.skills.includes(r.required_skill),
      text: `Нужен навык «${r.required_skill_display}», у бригады: ${e.skills_display.join(', ')}` },
    { key: 'time', label: 'Время', ok: inWindow && inShift,
      text: `Приезд ${p.arrival}${p.waiting_minutes ? `, ждёт окна ${p.waiting_minutes} мин` : ''}, начало ${p.start} `
          + `(окно ${p.window_start}–${p.window_end}), окончание ${p.end}, смена до ${e.shift_end}`
          + (p.slack_minutes != null ? `, запас ${p.slack_minutes} мин` : '') },
    { key: 'transport', label: 'Ресурс', ok: !r.required_transport || r.required_transport === eff,
      text: r.required_transport
        ? `Нужен ${r.required_transport_display}, бригада: ${TRANSPORT[eff]}`
        : `Особый транспорт не нужен, бригада: ${TRANSPORT[eff]}` },
  ];
}
```
- **Одна строка сверху** — `ExplanationOut.summary`. **«Подробнее»** — три строки выше + `reasons[]` списком.
- **«Почему не другие»** — `local_alternatives` (до 3 строк). Формат уточнить по снимку: ожидаем `engineer_id` / `engineer_name` + `reason` или `text`. Если формат другой — показываем `JSON`-поля `reason`, `text`, `why`, что найдётся.
- **Неназначенная заявка** — блок «Почему не назначена»: `UnassignedOut.reason`, подсказка из `lib/explainTexts.ts` по `reason_code` (тексты `DESIGN_SPEC` §7.2).
- Если строка у нашего плана получилась `ok=false` — показываем как есть, в консоль `console.warn('[constraints] mismatch', …)`: это баг валидатора, сообщить Кириллу.

### 6.3. `compare.ts` — три колонки
Строки — как в макете: Задействовано инженеров · Пробег суммарно, км · Неназначенные · Начато в окне · Просрочено. Под «Наш план» — Δ к базовому FIFO.

| Строка | Наш план | Базовый FIFO | Реальный диспетчер |
|---|---|---|---|
| Задействовано инженеров | `columns.ours.engineers_used` | `columns.fifo.engineers_used` | `columns.dispatcher.engineers_used` |
| Пробег суммарно, км | `columns.ours.km_total` | `columns.fifo.km_total` | `columns.dispatcher.km_total`; при `km_is_estimate` подпись «оценка» |
| Неназначенные | `plan.summary.unassigned_count` | `plan.metrics?.baseline.unassigned_count` ?? расчёт из `coverage_pct` | расчёт из `coverage_pct` |
| Начато в окне | `inWindow(plan.routes)` | `inWindow(baseline.baseline_routes)` | «—» |
| Просрочено | `lateCount(plan.routes)` | `lateCount(baseline.baseline_routes)` | «—» |

**Правила расчёта:**
- **Неназначенные из `coverage_pct`:** `round(total × (1 − coverage_pct / 100))`, где `total = plan.summary.total_requests`.
- **`inWindow(routes)`** = «N/M»:
  - M — число точек маршрутов;
  - N — точки, где начало (`actual_start ?? start`) лежит в `[window_start, window_end]`.
- **`lateCount(routes)`** — точки, где начало позже `window_end` или стоит флаг `late`.
- ⏳ Если бэк добавит эти поля в `CompareColumn`, берём с бэка.
- **`baseline`** — ответ `POST /planning/baseline {plan_id}`, из него нужен `baseline_routes`. Кэш — на версию плана.

**До построения плана** (`plan_state = none`):
- запрос `POST /planning/compare {scenario_id, strategies: ['fifo','dispatcher']}` ⏳;
- если бэк отвечает — заполняем FIFO и диспетчера, «Наш план» — «—»;
- подпись под таблицей: «Нажмите «Построить план», чтобы заполнить колонку «Наш план». Пробег реального диспетчера — оценка»;
- при ошибке — «—» во всех колонках.

**Особые случаи:**
- Нет ключа `dispatcher` в `columns` → колонка «нет данных: только для CSV-дня». На синтетическом наборе (§6.8) — «нет данных: синтетический набор».
- **«Пробег по инженерам, км» в панели — «наш / FIFO»:**
  - наш — `RouteOut.distance_km`;
  - FIFO — `baseline_routes[].distance_km`;
  - незадействованная бригада — «—».
- **Таблица DS-05** — колонки «Бригада · Заявок н / F / д · Км наш · FIFO · Дисп.*»:
  - «н» — `RouteOut.task_count`;
  - «F» — `baseline_routes[].task_count`;
  - «д» — число заявок с `RequestOut.dispatcher_engineer_id = id`;
  - км диспетчера по бригаде — из `km_by_engineer`, формат смотреть по снимку; если данных нет — «—».
- Подписи «пример» и «цифры — пример» из макета не выводим.

### 6.4. `proposal.ts` — событие → предложение
**Вкладки DS-06 — три события (D-26).** Во всех: `apply: false`, `source: 'dispatcher'`, `event_time` из поля «Время события» (по умолчанию — `nowFor(clock)` дня, подпись «По умолчанию — сейчас»). `plan_id` — активный план региона, выбранного в форме.

| Вкладка | `type` | Поля формы | Тело запроса |
|---|---|---|---|
| Срочная заявка | `urgent_order_added` | Время события · Регион · Адрес (свободный текст) · Тип заявки HD — «Авария», поле только для чтения (D-37) · Требуемый транспорт (по умолчанию «Автомобиль») · инфо-строка «Аварийные работы · 80 мин на адресе · ориентир реакции до 2 ч» | `plan_id`, `event_time`, `request` (ниже) |
| Отмена | `order_cancelled` | Время события · Регион · Заявка (поиск по № или адресу среди заявок дня региона) · Причина («Клиент отказался» / «Другое» + текст) | `plan_id`, `event_time`, `order_id`, `params: {reason: 'client_refused' \| 'other', comment?}` ⏳ |
| Инженер недоступен | `engineer_unavailable` | Время («с какого времени») · Регион · Инженер (бригады региона на смене) · Причина — необязательно | `plan_id`, `event_time`, `engineer_id`, `params: {reason?}` ⏳ |

- Вкладки «Отмена» и «Инженер недоступен» в макете не нарисованы. Делаем в том же стиле, что «Срочная заявка»: сетка полей в 2 колонки, те же поля ввода и подписи.
- Строка «План не изменится, пока вы не примете предложение» и кнопки «Отмена» / «Рассчитать изменения» — на всех вкладках.
- «Смены транспорта» и «Задержки» у диспетчера нет. Транспорт меняется через «Состав и ресурсы» (DS-09).

**`request` для срочной заявки** (`RequestIn`):
```ts
{ id: `U-${Date.now().toString(36).toUpperCase()}`, address,            // адрес — свободный текст, геокодит бэк ⏳
  duration_minutes: 80, window_start: eventTime, window_end: shiftEnd /* max shift_end бригад региона на смене, не '22:00' */,
  priority: 'urgent', required_skill: 'emergency', required_transport: transport ?? 'car',
  type_bk: 'Глобальная проблема', type_hd: 'Авария', source: 'dispatcher' }
```
Запасной путь, если бэк не геокодит адрес ⏳: поле «Адрес» подсказывает адреса заявок дня региона. Выбранная подсказка подставляет их `latitude` / `longitude`.

**Ответ → DS-07:**
1. `result.status === 'proposed'`: новый план — `result.plan`, прежний — `result.previous_plan_id`.
2. Запрос `GET /planning/{new}/diff?against={previous}`. Из ответа берём:
   - шапку: «Предложение: {событие}»; строку «Версия {v} → {v+1} · рассчитано в {HH:MM из plan.created_at}»;
   - заголовок-итог — `diff.headline`;
   - чипы-счётчики: Передано · Новый порядок · Сдвиг времени · Добавлено · Без исполнителя · Не тронуто.
3. **«Что изменится»** — `changes[]` сгруппированы по бригадам. Строка — тип и описание:

| Тип в `changes` | Строка в DS-07 | Пример |
|---|---|---|
| `added` | «Добавлена» | «U-0001 · Авария · 13:25–14:45» |
| `reordered` | «Новый порядок» | «…2310, U-0001, …5129» |
| `time_shifted` | «Сдвиг» | «№…5129: 14:00 → 15:00 (+60 мин)» |
| `reassigned` | «Передана» | «№…7780: Бригада Соколов → Бригада Мельников, 16:00 → 16:20» |
| `removed` | «Снята» | — |
| `newly_unassigned` | «Без исполнителя» | — |

   Незнакомый тип — строка «Изменение: {type}», без падения.
4. Итоговая строка: «Инженеров X → Y · Пробег A → B км (±Δ)» — из `metrics_before` / `metrics_after`.
5. **Карточка решения по аварии** — только для `urgent_order_added`:
   - поля — из `applied_event.decision ?? applied_event`: `engineer_id`, `arrival`, `reaction_minutes`, `rule`, `alternatives[]`;
   - если их нет — берём из diff (`added` по срочной заявке → бригада и начало; реакция = начало − `event_time`);
   - вид: чип «Срочная», «Бригада X — прибытие HH:MM, реакция N мин», правило одной строкой, таблица «Бригада · Свободна · В пути · Прибытие» с пометкой «выбрана»;
   - реакция > 120 мин → флаг «Реакция > 2 ч».
6. **«Показать на карте»:** изменённые маршруты подсвечены, старые — серым пунктиром.
7. **Кнопки:**
   - «Принять изменения» → `POST /planning/{new}/apply` → тост «Версия N применена. Инженеры получили обновление»;
   - «Отклонить» → `/reject`;
   - «Править вручную» → DS-08 на базе предложенного плана.
8. **`409 STALE_PROPOSAL`** → в дровере «План уже изменился. Пересчитать?» → повторяем тот же `POST /events/apply`. Тело запроса храним в состоянии дровера.
9. **Режим просмотра** — открыт из «Версии»: diff двух версий без карточки решения и без кнопок.
10. **Предложения, ждущие решения** — `DayRegion.pending_proposals`:
    - тёмный баннер под шапкой дня;
    - строки ленты с `needs_decision` (кнопки «Открыть» / «Решить») → `proposal=<plan_id>` → DS-07;
    - так же решаются «Отменяется» / «Переносится» от инженеров (D-29).

### 6.5. `feed.ts` — лента дня
Как в макете: фильтр «Все / Требуют решения N», строки новые сверху.

**Строка ленты:** время · иконка типа · текст · (необязательно) чип статуса или флага · вторая строка · действие справа.

| Поле | Откуда |
|---|---|
| Время | `payload.event_time ?? created_at` в HH:MM (Europe/Moscow) |
| Текст | `payload.headline` ⏳; иначе шаблон по `event_type` из `DESIGN_SPEC` §7.3 со значениями из `payload` (номер — последние 4 цифры с «…» или полный, имена бригад — из `DayModel`) |
| Чип | статус или флаг заявки из `payload` (`status`, `flag`): «Просрочена», «Отменяется», «Под угрозой» — `StatusChip` / `FlagChip` |
| Вторая строка | «Принято в HH:MM» — если есть применённый `result_plan_id`; «по плану версии N» — для фактов инженера |
| Действие | `needs_decision` и есть `result_plan_id` → «Открыть» (DS-07). Заявка в `cancel_pending` / `reschedule_pending` → «Решить» (DS-07 её предложения) |

**Иконки по типу:**

| Тип события | Иконка |
|---|---|
| `urgent_order_added` | `zap` |
| `order_cancelled`, `fail` | `x-circle` |
| `engineer_unavailable` | `user-x` |
| `order_added` (запись встроена) | `calendar-plus` |
| применена версия | `check` |
| `at_risk` | `clock-alert` |
| `late` | `alarm-clock-off` |
| факты инженера | `map-pin` |
| остальное | `circle-dot` |

- **Какие события должны приходить в ленту** ⏳ (правка бэка): события из `/events/apply`, факты инженера (прибыл, начал, выполнил, прервал), системные (версия применена, «Под угрозой», «Просрочена», запись встроена).
- **Бейдж на вкладке «Лента»** — число `needs_decision` [Д].

### 6.6. `geo.ts` — геометрия карты
- Для карты используем **`GET /visualization/{plan_id}/geojson?geometry=road`**: там порядок координат `[lon, lat]` задан явно. `RouteOut.geometry` не используем — порядок не описан.
- Какому инженеру принадлежит линия — `feature.properties.engineer_id`; уточнить по снимку.
- Если GeoJSON не пришёл или пуст — рисуем прямые отрезки по `start_latitude/longitude` → `RoutePoint.latitude/longitude` по `sequence`.
- `geometry_source` для не-авто: линия автомобильная, время — расчётное. Подписываем в легенде: «линия — по дорогам, время — по типу транспорта».
- **До построения плана** — только точки заявок из `ScenarioOut.requests` (нейтральные маркеры) и офис. По центру сверху плашка «{N} заявок загружены из CSV · план ещё не построен».
- **Условные координаты синтетики** — перенос к офису, прямые отрезки вместо дорог, без кнопки Яндекса: §6.8.

### 6.7. Ручное переназначение (DS-08)
- Заголовок: «Заявка №… → инженер», подпись «{Тип} · окно {окно} · {адрес}».
- **Кандидаты** — бригады региона на смене, кроме текущей:
  - сначала фильтр на фронте по навыку и транспорту;
  - не прошедшие фильтр идут вниз списка с меткой «Нет навыка» / «Нет авто» и без запроса к API;
  - бригада без заявок в текущем плане — метка «Не работает сегодня» (neutral) и подпись «вызов с выходного — решение диспетчера». Выбрать можно: `check` как обычно, чип «Инженеров +1». Если `check` вернул `engineer_idle_today` — берём его (D-38, бэк 13.2);
  - для остальных — до 5 ближайших к заявке — параллельно `POST /planning/{id}/reassign/check {order_id, to_engineer_id}`.
- **Строка кандидата:** точка цвета, «Бригада X», подпись и метка.
  - Подпись: «свободен HH:MM · X км» / «начало HH:MM» / «пешком · X км» — из `new_start`, `delta_km`, транспорта.
  - Метки по ответу `check`:

| Ответ | Метка |
|---|---|
| `feasible` | «Подходит» (success) |
| нарушено окно | «Вне окна» (danger) |
| прочее нарушение | «Нарушение» (danger) |

- **«Позиция в маршруте»** — select «После №… · начало HH:MM» по точкам маршрута выбранной бригады (`position` = номер точки + 1). При смене — повторный `check`.
- **Результат проверки:**
  - `feasible` → зелёная плашка «Все три ограничения соблюдены»;
  - иначе — красная плашка со списком нарушений: ключи `checks` сводим к «Квалификация / Время / Ресурс» по словарю (`skill, qualification → Квалификация`; `time, window, shift → Время`; `transport, resource → Ресурс`). Текст — из значения или шаблон, например «Время: начало 16:40 вне окна 14–16».
- **Чипы-последствия:**
  - «Уйдут в просрочку: №… / нет» — из `late_visits`;
  - «Пробег ±X км» — из `delta_km`;
  - «Инженеров ±N» — считаем сами: −1, если маршрут «откуда» опустеет; +1, если маршрут «куда» был пуст.
- **Кнопки:**
  - `feasible` → primary «Применить»;
  - иначе → «Применить с нарушением» (иконка ⚠, после подтверждения, `force: true`).
  - Оба варианта: `POST /reassign {order_id, to_engineer_id, position, force}` → `ReplanResult` (`proposed`) → сразу `POST /planning/{new}/apply`. Это ручное решение диспетчера, второго подтверждения не нужно [Д].

### 6.8. `normalize.ts` — синтетические наборы (`*.instance.json`) · P0
**Что это.** Алгоритм бэка работает и на синтетических наборах `{pattern}_n{заявок}_k{бригад}_seed{N}.instance.json`: pattern — `clustered` / `mixed` / `spread`, в проекте сейчас n30_k8 × 6 файлов и `demo_30.json`, у бэка есть и n60_k12. Это формат **входа алгоритма**, а не ответ API. Фронт видит эти данные только через `ScenarioOut` / `PlanResponse`. В наборе нет полей CSV-дня, поэтому у заявки и бригады надёжно заполнены только id, окно, длительность, навык, транспорт и смена. Остальное может прийти пустым или условным.

**Формат набора** (факт, проверено по 7 файлам проекта):
```
tasks[]:     id "T000", node, duration (мин), window_start / window_end (мин от полуночи),
             skill: local | installation | emergency, transport: null | 'car', urgent, release_time
engineers[]: id "E00", start_node, shift_start / shift_end (мин), skills[], transport, used_today,
             available (в demo_30 поля нет), locked_prefix[]
travel_minutes{car, walk, bike, public_transport}, distance_m{…}: матрицы N×N, N = k + n
             (узлы 0…k−1 — старты бригад, дальше — заявки)
service_by_engineer, previous_assignment, previous_predecessor — для перепланирования
metadata: synthetic, seed, pattern, coordinates_km [[x, y]] (плоские км, не широта/долгота), warning
```

**Поле набора → API → экран → запасное значение.** Всё — в `adapters/normalize.ts`. Компоненты берут готовые подписи, сырые поля напрямую не читают.

| В наборе | В API | Где на экране | Если пусто |
|---|---|---|---|
| `id` "T000" | `RequestOut.id` | везде | `shortId`: id ≤ 6 символов — целиком («№T012»), длиннее — «…7741» |
| `window_start/end`, мин | `window_start/end` "HH:MM" | окна, таймлайн | есть всегда |
| `duration` | `duration_minutes` | DS-04 | подпись «{N} мин» без «по нормативу» |
| `skill` | `required_skill` | тип, фильтр, «Квалификация» | есть всегда |
| `transport` | `required_transport` | «Ресурс» | `null` → «любой» |
| `urgent` | `priority`, флаг `urgent` | чип «Срочная» | Это не авария. В наборах срочными бывают локальные заявки и подключения, а аварийные — несрочные. Красный маркер с `zap` ставим по `isEmergency` (§10.1: HD «Авария»; без HD — BK «Глобальная проблема»; без BK и HD — навык `emergency`, D-37), чип «Срочная» — по `urgent` |
| — | `type_bk`, `type_hd` | карточка, таймлайн, тултип, фильтр «Тип заявки» | подпись по навыку: `emergency` «Авария» · `installation` «Подключение и дозаказ» (коротко «Подкл.») · `local` «Локальные работы» («Лок.»); фильтр «Тип заявки» на таком дне — по навыку |
| — | `address` | DS-04, «Неназначенные», поиск в DS-06, DS-08 | «Адрес не указан» (серым); поиск — только по номеру |
| — | `district` | DS-04, «Неназначенные» | строку не выводим |
| — | `gigabit`, `technology` | DS-04 | строку не выводим |
| — | `dispatcher_engineer_id` | «Сравнение», DS-05 «д» | «нет данных: синтетический набор» / «—» |
| `coordinates_km` | `latitude/longitude` | карта, Яндекс Карты | см. «Координаты» ниже |
| engineer `id` "E00" | `EngineerOut.id`, `name` | чипы, таймлайн, DS-08, DS-09 | `name` пуст или равен id → «Бригада E00», в чипе — «E00» |
| `start_node` | `latitude/longitude`, `start_kind` | старт маршрута | координаты — как у заявок; `start_kind` пуст → «старт» |
| `shift_start/end`, мин | `shift_start/end` "HH:MM" | таймлайн, «Время» | есть всегда. **В наборах 09:00–19:00, в CSV-днях 10:00–22:00** — часы нигде не зашиваем |
| `available` | `available` | DS-09 | нет поля (`demo_30`) → `true` |
| — | `ScenarioOut.date`, `region_id`, `office` | шапка, календарь, маркер офиса | дату ставит бэк при загрузке [Д]; без `office` маркер офиса не рисуем |

**Фронту не нужны, не запрашиваем и не храним:**
- `travel_minutes`, `distance_m` — для n60_k12 это 72 × 72 × 8 ≈ 41 тыс. чисел; время и км по плечу уже есть в `RoutePoint.travel_minutes` / `leg_distance_km`;
- `node`, `start_node`, `used_today`, `locked_prefix`, `previous_assignment`, `previous_predecessor`, `service_by_engineer`, `release_time` — внутренние поля алгоритма; их результат фронт видит через `RoutePoint.frozen`, diff и метрики;
- `metadata.seed`, `metadata.pattern` — только для README и таблицы прогонов.

**Признак синтетики** `isSynthetic(scenario)` [Д] — по первому сработавшему условию:
1. `scenario.source` содержит `synth` / `instance` / `bench` ⏳ (явное значение просим у бэка);
2. id заявок вида `T\d{3}`, бригад — `E\d{2}`;
3. точки вне рамки Московского региона: широта 54,2…57,0, долгота 35,1…40,3.

**Что меняется на синтетическом дне:**
- бейдж «Синтетика» рядом с «CSV» в шапке дня и в «Сравнении». Тултип: «Координаты, длительности и состав бригад сгенерированы. Для оценки на реальных данных — дни из CSV» (это `metadata.warning`);
- **координаты.** Если пришли условные (точка вне рамки региона — например, бэк положил `coordinates_km` в `latitude/longitude` как есть, и точки оказались в Африке), переносим облако к офису региона (нет офиса — центр Москвы 55,751 / 37,618):
  `lat = lat0 + (y − ȳ) / 111,32`, `lon = lon0 + (x − x̄) / (111,32 · cos lat0)`,
  где x — пришедшая долгота, y — широта, x̄ / ȳ — средние по всем точкам дня (заявки и старты бригад).
  - Одно преобразование — для точек, стартов и линий GeoJSON.
  - Дорожную геометрию не берём, рисуем прямые отрезки.
  - На карте плашка «Координаты условные»;
- кнопку «Маршрут в Яндекс Картах» не показываем: координаты условные;
- «Реальный диспетчер» — «нет данных: синтетический набор», в DS-05 колонка «д» — «—»;
- экран инженера на синтетике не проверяем: у бригад `E00…` нет учётных записей.

**Особенности наборов, которые видны в интерфейсе.** У всех 8 бригад одна смена 09:00–19:00, окна заканчиваются не позже 18:00, бригад с одним навыком нет. Поэтому на синтетике ограничения «Время (смена)» и «Квалификация» срабатывают редко. Три ограничения и три колонки сравнения показываем в демо на CSV-дне Востока, синтетику — только для масштаба.

**Масштаб.** n60_k12 — 60 заявок и 12 бригад. 12 цветов палитры хватает ровно. Если бригад больше 12, цвета идут по кругу, у повторов линия пунктиром (§10.2). Ряд чипов бригад уже прокручивается.

**Тесты (vitest)** на фикстуре `docs/api-examples/synthetic-scenario.json` (снимок §12, шаг 17). Если бэк не отдаёт синтетику через API — ручная фикстура на 3 заявки и 2 бригады: пустые `type_bk` / `address` / `district` / `technology`, id `T000`, координаты в плоских км. Проверяем:
- подписи по навыку и «№T000»;
- перенос координат к офису;
- скрытую кнопку Яндекс Карт;
- «нет данных» у диспетчера;
- ось таймлайна 09–19.

---

## 7. Часы дня (D-24, D-28) · P0
**Зачем:** смена идёт 10:00–22:00, а видео пишем вечером, эксперты открывают стенд после 23:00. Поэтому у дня есть серверные часы. Если их нет — реальное время.

**Во фронте часы только показываются — элемента управления нет (D-28).**
- `clock` дня — в `DayRegion.clock` ⏳ и в `ScenarioOut.clock`; у инженера — в `EngineerMeDay.clock` ⏳.
- `lib/time.ts`: `nowFor(clock) = clock ?? nowMsk()`.
- **Где используется:**
  - в шапке дня — «Версия N · сейчас HH:MM»;
  - время события в DS-06 по умолчанию;
  - линия «сейчас» на таймлайне;
  - у инженера — «Сейчас · HH:MM» в шторке «Не могу работать» (E-08);
  - `at` у действий инженера **не шлём**: бэк берёт часы дня.
- **Кто переводит часы:**
  - бэк при старте сидит демо-день Востока с часами 12:30;
  - для видео — `POST /data/scenarios/{id}/clock {time, autoplay: true}` через Swagger. Инструкция — в README, раздел «Демо-время».
- **Запасной путь** (флаг `dayClock = false`, §5.4; на 28.09 01:20 ручек часов в схеме нет), если бэк не вернёт часы до 28.09 12:00: параметр `?clock=HH:MM` в адресе дня диспетчера. `event_time` тогда шлём явно; автопрогона нет, видео снимаем от начала смены.

---

## 8. Экраны: логика
Вёрстка:
- **диспетчер** — макет `design/Dispatcher_Flow.html` (согласован 27.09). При расхождении с `DESIGN_SPEC` §6 прав макет и этот раздел;
- **инженер** — макет `design/Engineer.html` (согласован 28.09) и §9;
- **оператор** — макет `design/Operator.html` (согласован 28.09) и §8.3;
- вход — `design/` и `DESIGN_SPEC` §6.

Здесь только поведение и данные.

### 8.1. Общее
- **S-01 Вход:**
  - `POST /auth/login` → токен → `GET /auth/me` → редирект по `role`;
  - ошибка 401 — «Неверный логин или пароль»;
  - подвал: «Прототип сервиса для оператора связи».
- **AppBar (десктоп):**
  - логотип, «Оператор связи · Маршруты инженеров»;
  - у диспетчера — вкладки «Календарь / День»;
  - справа — имя, подпись «{Роль} · {все регионы | названия регионов}», «Выйти» (`POST /auth/logout` → очистить токен и кэш).

### 8.2. Диспетчер — итоговое ТЗ (согласовано по макету 27.09)
**Общее для экранов диспетчера:**
- Вкладка «День» ведёт на последний открытый день (`sessionStorage.last_day`), иначе на сегодня.
- **Фильтры** — «Регион · X», «Статус», «Тип заявки». Каждый — один выбор, «Сбросить» есть только в календаре. **Фильтра по флагам нет** (D-27).
- **Регион:**
  - в календаре можно выбрать «Все регионы»;
  - день всегда показывает **один** регион. Из календаря с «Все регионы» открываем первый регион пользователя [Д]. Группировки по регионам нет.

**DS-01 Календарь заявок · P0**
- **Шапка:** «Календарь заявок», переключатель месяца, «Сегодня»; справа «{N} заявок за месяц · {K} региона». N — сумма `request_count`.
- **Легенда и полоса в ячейке — по статусам ТЗ** (D-29), не по группам макета:
  - сегменты по `by_status` в порядке: `done`, `in_progress`, `en_route`, `planned`, `cancel_pending`, `reschedule_pending`, `unassigned`;
  - тона — из `lib/statuses.ts`;
  - `cancelled` и `rescheduled` в полосу не входят;
  - легенда показывает только статусы, которые встречаются в месяце.
- **Ячейка:**
  - число, бейдж «CSV» (если в `sources` есть `csv` / `demo`), «N заявок»;
  - полоса статусов;
  - «N не назначена» — из `by_status.unassigned`, иконка `alert-circle`;
  - «N просрочена» — из `flags.late`, иконка `alarm-clock-off`;
  - сегодня — тёмная рамка и подпись «СЕГОДНЯ»; дни соседних месяцев приглушены; пустой день — «—».
- **Подсказка по наведению:** «Пн, 29 сентября · 66 заявок» + строка на каждый ненулевой статус (подпись и число) + «Флаг «Просрочена» N».
- **Клик** → `/dispatcher/day/:date?region=…`.
- **Состояния:** загрузка — скелетоны ячеек; пустой месяц — «В этом месяце заявок нет. Загрузите CSV или дождитесь записей оператора».
- Primary в AppBar — «Загрузить CSV» (`modal=import`).

**DS-02 Загрузка CSV · P0**
- **Шаг 1 — «Загрузка CSV»:**
  - подпись «Шаг 1 из 2 · файлы. Можно загрузить от 1 до 3 регионов»;
  - три карточки регионов: название + «N бригад» (из `GET /regions` → `engineer_count`);
  - в карточке две зоны: «Файл заявок (.csv)» («Перетащите файл или выберите») и «Контрольное распределение — по желанию» («Нужен для сравнения с реальным диспетчером»);
  - выбранный файл: имя, «66 строк · 48 КБ» (строки считаем на клиенте: без заголовка, пустых строк и строки «Адрес Офиса»), кнопка ✕;
  - кнопки «Отмена» и primary «Загрузить» — активна, если есть хотя бы один файл заявок.
- **Даты нет** (D-26): `date = todayMsk()`. Регионы грузим параллельно через `POST /data/import-beeline`. Ссылки на демо-набор нет.
- **Шаг 2 — «Отчёт импорта · Шаг 2 из 2 · план на DD.MM.YYYY»**, карточка на регион:
  - бейдж «Готово» — если нет замечаний; «Есть замечания» — если есть предупреждения, пропущенные строки или нет контрольного файла;
  - строки с иконками из `import_report`:
    - «Загружено X из Y заявок»;
    - «Офис: …»;
    - «Автомобиль нужен N заявкам (заполнено правилом: …)»;
    - «Назначений реального диспетчера: X из Y»;
    - предупреждения — списком;
    - «N строки пропущены: …»;
    - без контрольного файла — «Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»».
  - подвал: «Всего N заявок · K региона · M бригад», «Назад», primary «Открыть день» → `/dispatcher/day/<date>?region=<первый загруженный>`.
  - **Ошибка региона** (`BAD_CSV`, `ROWS_MISMATCH`, `REGION_UNKNOWN`, `DATE_HAS_BOOKINGS`) — та же карточка с красным бейджем «Ошибка» и `message` из `ApiError`. Макета нет, делаем в коде в стиле карточки «Есть замечания».

**DS-03 День · P0**
- **Шапка:**
  - «‹ Пн, 29 сентября ›» (предыдущий / следующий день), бейдж «CSV»;
  - статус: `plan_state = none` → «{N} заявок · плана нет»; иначе «Версия N · сейчас HH:MM» (§7);
  - фильтры «Регион», «Статус», «Тип заявки»;
  - кнопки справа:

| Состояние | Второстепенные | Primary |
|---|---|---|
| `none` (CSV-день) | «Состав и ресурсы» | **«Построить план»** → `POST /planning/run` → сразу `POST /planning/{plan_id}/apply` (D-25). Лоадер «Строим план…» |
| `draft` (день из записей оператора) | «Состав и ресурсы» | «Начать рабочий день» → `POST /planning/{draft_plan_id}/apply` |
| `applied` | «Итоги дня» + меню «⋯» → «Состав и ресурсы» | «Добавить событие» |

- **Баннер предложения** (тёмный, под шапкой) — если есть `pending_proposals`:
  - текст «Есть предложение после события «{событие}»: изменилось N назначений»;
  - справа «HH:MM · ждёт решения» и кнопка «Открыть» → DS-07;
  - N = сумма счётчиков diff (передано + новый порядок + добавлено + снято + без исполнителя).
- **Слева:**
  - сегменты «Карта / Таймлайн»;
  - чипы «Все бригады · 12» и по бригаде: точка цвета, фамилия (без «Бригада»), иконка транспорта, «{task_count} · {distance_km} км» (не задействована — «—»);
  - ряд чипов прокручивается по горизонтали;
  - клик по чипу — фильтр бригады: на карте остальные маршруты 30%, на таймлайне строка подсвечена [Д].
- **Карта:**
  - до плана — §6.6;
  - после плана:
    - маршруты с номерами точек;
    - выполненная точка — «галочка» цвета бригады;
    - авария (`isEmergency`, §10.1) — красный маркер с `zap`;
    - неназначенная — красный пунктирный круг с «!»;
    - офис;
    - кнопки масштаба +/−;
    - легенда свёрнута: «Легенда · линия = маршрут бригады»;
  - тултип: «№305838184 · Подключение · окно 18–20 / Бригада Соколов · начало 18:00»;
  - клик по назначенной → DS-04; по неназначенной → вкладка «Неназначенные» с прокруткой к заявке (D-29).
- **Таймлайн:**
  - шапка «БРИГАДА» + часы от min `shift_start` до max `shift_end` бригад дня, по целым часам (CSV-день — 10–22, синтетика — 09–19); линия «сейчас» с плашкой HH:MM;
  - **строка бригады:** точка, «Бригада X», иконки транспорта и навыков, «7 заявок · 42,3 км»; незадействованная — «не задействован», приглушена;
  - **блок заявки:**
    - «…7741» (последние 4 цифры; короткий id вида `T012` — целиком) и «Подкл. · 10–12»;
    - сокращения типа: Подключение «Подкл.» · Локальная заявка «Лок.» · Дозаказ «Дозак.» · Глобальная проблема — «Авария» при HD «Авария», «Информ.» при HD «Информация» (D-37); нет `type_bk` — по навыку (§6.8);
    - дорога — штриховкой, ожидание — пунктиром;
    - иконки флагов;
  - у выбранного блока — полоса «ОКНО 18–20»;
  - последняя строка — «Неназначенные · N заявки», блоки по окнам;
  - клик — как на карте.
- **Правая панель, вкладки:**
  - **«Сравнение»** — §6.3; кнопка «На весь экран» → DS-05.
  - **«Неназначенные · N»:**
    - подзаголовок «клиентское окно не двигаем»;
    - карточка:
      - «№… {Тип} · окно …»;
      - адрес · район;
      - причина (красным, иконка по коду);
      - «Что поможет: …» (§6.2, `lib/explainTexts.ts`);
      - кнопки «Назначить вручную» (→ DS-08) и «Добавить инженера» (→ DS-09 с открытой формой добавления).
  - **«Лента · N»** — §6.5.
  - **«Версии»:**
    - «Версии плана · новые сверху»;
    - карточка: «Версия N · HH:MM» + бейдж «Текущая»; строка события (для первой — «План построен по CSV · {регион}»); «K бригад · M заявок · X км»; кнопка «Сравнить с текущей» → DS-07 в режиме просмотра;
    - данные — `GET /planning?scenario_id` (`created_at`, `engineers_used`, `planned_count`, `total_distance_km`, `status`), только `applied` / `superseded`;
    - ⏳ `version` и заголовок события — с бэка. Запасной путь: номер по порядку, заголовок — из событий с таким `result_plan_id`.

**DS-04 Карточка заявки · P0** — только для назначенных заявок (D-29).
- **Шапка:** «№305838184», «Подключение · Конвергенция абонента», `StatusChip`, флаги.
- **Серый блок:**
  - адрес;
  - район;
  - временное окно;
  - «Приезд · начало · окончание»;
  - длительность «70 мин по нормативу»;
  - «Гигабит · технология»;
  - требуемый транспорт;
  - инженер (точка, «Бригада X · транспорт»);
  - «№ в маршруте · от предыдущей» — «7 из 7 · 3,2 км».
- **«Почему этот инженер»:** `summary`; «Подробнее» раскрывает три ограничения (§6.2); ниже «Почему не другие» — до 3 строк.
- **Подвал:**
  - «Отменить заявку» (красная обводка) → DS-06 на вкладке «Отмена» с этой заявкой;
  - «Переназначить» → DS-08.

**DS-05 Сравнение на весь экран · P0**
- Шапка «Сравнение планов · {регион}, {дата}», подпись «Версия N · {заявок} заявок · {бригад} бригад».
- Слева три колонки крупно: инженеры, пробег (у диспетчера подпись «оценка»), неназначенные — с Δ.
- Справа таблица по бригадам (§6.3).
- Сноска: «Базовый вариант FIFO — заявки по порядку строк файла, каждая в конец маршрута первого подходящего инженера, без оптимизации. Пробег реального диспетчера — оценка: порядок визитов в выгрузке не указан».

**DS-06 Событие · P0** — §6.4.

**DS-07 Предложение · P0** — §6.4.

**DS-08 Переназначение · P1** — §6.7.

**DS-09 Состав и ресурсы · P1**
- **Дровер:** «Состав и ресурсы», подпись «{регион} · {дата} · {N} бригад».
- **Рекомендация** (голубая плашка) — если есть неназначенные:
  - запрос `POST /planning/{id}/extend-resource {order_ids: <неназначенные>, option: 'add_engineer'}` ⏳;
  - текст «Чтобы назначить N неназначенные, не хватает +K инженера с навыком «…» и {транспортом}»;
  - если из ответа это не собрать — плашку не показываем.
- **Таблица:**

| Колонка | Содержимое | Редактируется |
|---|---|---|
| «ИНЖЕНЕР · НАВЫКИ» | имя и чипы навыков | нет |
| «ТРАНСПОРТ» | select | да |
| «СМЕНА» | текст | нет |
| «В ДЕНЬ» | переключатель (`available`) | да |

  Выключенная бригада приглушена.
- **«+ Добавить инженера»** — строка-форма: имя, навыки, транспорт, смена (по умолчанию — самая частая смена в ростере региона, иначе 10:00–22:00) → `POST /data/scenarios/{id}/engineers`. До публикации — всегда; после — только при `addEngineerAfterPublish` (таблица финального макета ниже, п. 4).
- **Primary «Пересчитать план»:**
  - **до публикации:** `PATCH /data/scenarios/{id}/engineers/{engineer_id}` для изменённых → `POST /planning/run` (для CSV-дня — и сразу `apply`, D-25);
  - **после публикации** (подпись «Изменения станут событием и придут предложением»):
    - смена транспорта → `POST /events/apply {type: 'transport_changed', engineer_id, params: {transport}}`;
    - выключение → `engineer_unavailable`;
    - включение → `engineer_available`;
    - по одному изменению за раз [Д] → открывается DS-07.

**DS-10 Итоги дня · P1**
- **Шапка:** «Итоги дня · {дата}», подпись «{регион} · версия N».
- **Карточки:**
  - «Выполнено» — X, «из M назначенных»;
  - «Отменено» — N, частая причина ⏳;
  - «Перенесено» — N, «на DD.MM» ⏳;
  - «Неназначенные» — N, «перейдут на {следующий день}».
  - Где данных нет — подпись не показываем.
- **Крупные показатели:**
  - «Начато в окне X из Y» + Δ к FIFO;
  - «Пробег суммарно, км» (жёлтая плашка) + Δ к FIFO;
  - «Задействовано инженеров» + Δ к FIFO.
- **Таблица по бригадам:** Заявок · Выполн. · В окне · Км · Дорога (Σ `travel_minutes`) · Работа (Σ `end − start`) · Ожид. (Σ `waiting_minutes`). Считаем по активному плану; где есть факт — по факту.

**Общее для диспетчера — без макетов, делаем в коде:**
- **Тосты:**
  - «Версия N применена. Инженеры получили обновление»;
  - «План построен и опубликован»;
  - ошибки — через `toApiError`.
- **Пустые состояния, скелетоны загрузки, ошибка сети** с кнопкой «Повторить».

**Финальный макет диспетчера (28.09) против этого раздела.** Сверено по `design/Dispatcher_Flow.html`: все экраны DS-01…DS-10 в макете есть, почти все тексты совпадают. Где расходятся — делаем по таблице.

| # | Где | В макете | Делаем |
|---|---|---|---|
| 1 | DS-01, DS-03 | фильтр «Флаги» | **как в ТЗ:** фильтра «Флаги» нет (D-27) |
| 2 | DS-01 | легенда и полоса по 5 группам, в полосе отменённые и просрочка | **как в ТЗ:** 7 статусов `by_status`, без `cancelled` / `rescheduled` и флагов (D-29) |
| 3 | DS-03 `applied` | только «Итоги дня» и «Добавить событие» | **как в ТЗ:** + меню «⋯» → «Состав и ресурсы» |
| 4 | DS-09, «Неназначенные» | «+ Добавить инженера» есть и после публикации | флаг `addEngineerAfterPublish` (§5.4, ⏳ бэк §12). **Включён:** `POST /data/scenarios/{id}/engineers` → `POST /events/apply {type: 'engineer_available', engineer_id, apply: false}` → DS-07. **Выключен:** после публикации строки добавления нет, «Добавить инженера» в карточке неназначенной открывает DS-09 без формы [Д] |
| 5 | DS-06 | тип HD: Авария / Нет линка / Разрывы / Работа с кабелем | **только «Авария»**, поле только для чтения (D-37: авария — по HD, ответ №80) |
| 6 | Лента | событие и предложение — две строки, у предложения чип «Ждёт решения» | **как в ТЗ:** одна строка на событие (§6.5); чип «Ждёт решения» у строк с `needs_decision` берём из макета |
| 7 | DS-08 | кандидат с меткой «Нет авто» выбран и проверен | **дописано:** отсеянных по навыку и транспорту можно выбрать — тогда делаем `check` и показываем нарушения; место в списке и метка не меняются |
| 8 | DS-06 | «Требуемый транспорт»: «Не требуется» + 4 вида | **как в макете;** «Не требуется» → `null`, по умолчанию «Автомобиль» |
| 9 | DS-02 шаг 2 | «Готово» при наличии предупреждения | **как в ТЗ:** любое замечание → «Есть замечания» |
| 10 | DS-02 шаг 1 | «Контрольное распределение · 66 строк» без КБ | **как в макете** |
| 11 | DS-01 подсказка | два статуса в одной строке | **как в ТЗ:** строка на каждый ненулевой статус |
| 12 | баннер DS-03 | «изменилось 3 назначения» при счётчиках 2+1+1 | **как в ТЗ:** N = передано + новый порядок + добавлено + снято + без исполнителя |
| 13 | DS-07 | группа «Бригада Матвеев → Бригада Попов» | **дописано:** передачу кладём в группу бригады «откуда», заголовок группы — только «Бригада X» |
| 14 | DS-04 | формулировки трёх ограничений | **как в макете:** «у бригады есть», «(окно 18–20)», «Нужен автомобиль, бригада на автомобиле». Причину в скобках («работа с кабелем») — только если она есть в данных. `reasons[]` под «Подробнее» оставляем |
| 15 | DS-04 | «Отменить заявку» — `danger` с заливкой | **как в макете** |
| 16 | «Сравнение» | сноска после плана «Δ — к базовому FIFO. Пробег реального диспетчера — оценка.» | **как в макете** + подпись «оценка» в ячейке при `km_is_estimate` |
| 17 | Δ везде | три разных формата | один форматтер `formatDelta` в `lib/format.ts`: «−38,2 км (−12%)», «−2 инженера», «−4» |
| 18 | таймлайн до плана | в строке «смена 10–22», у чипов нет цифр, нет линии «сейчас» | **как в макете,** смену — из данных бригады. Блок визита: заливка по тону статуса (`lib/statuses.ts`), левая кромка 3 px цветом бригады (`DESIGN_SPEC` §6 DS-03) |
| 19 | таймлайн «Неназначенные» | блоки ≈ 1,4 ч от начала окна | подпись как в ТЗ, блок — на всё окно |
| 20 | чипы бригад | обрезаны затуханием | прокрутка по горизонтали (ТЗ) + затухание по краю (макет) |
| 21 | Лента | иконки «прибыл» — `zap`, «освободился» — `timer`, счётчик 3 при 2 ждущих | **как в ТЗ:** иконки по §6.5, счётчик = число `needs_decision` |
| 22 | DS-09 | чипы навыков «Подкл. / Авария / Локальные» | один словарь сокращений: «Подкл.», «Лок.», «Авария» |
| 23 | DS-08 | подписи «занят до 16:10», «пешком · начало 16:40» | **как в макете,** значения — из `check` и транспорта |
| 24 | после «Построить план» | кадр показывает «Версия 3», баннер и ленту с аварией U-0001 | **артефакт макета:** после построения — «Версия 1 · сейчас …», тост «План построен и опубликован», баннера нет |

Нет в макете, но есть в ТЗ — делаем по ТЗ из `ui/*`:
- состояние `draft` («Начать рабочий день») и лоадер «Строим план…»;
- вкладки DS-06 «Отмена» и «Инженер недоступен»;
- режим просмотра DS-07 и ответ `STALE_PROPOSAL`;
- карточка ошибки импорта;
- тосты;
- вид синтетического дня (§6.8);
- развёрнутая легенда карты;
- ошибка сети, ошибка входа.

### 8.3. Оператор — итоговое ТЗ (по макету `design/Operator.html`, 28.09)
Вёрстка — по макету: десктоп 1440×900, минимальная ширина 1280. При расхождении макета с этим разделом прав раздел. Решения — D-33…D-35 (сверка — `OPERATOR_SPEC_REVIEW_28-09.md`; О-5 отклонено). Правки бэка — `BACKEND_FIXES_FINAL_28-09.md` §9, флаги — §5.4. Порядок работ — §17.3.
**Критерии:** Подход 25% (сценарий B «Живой день», D-01, D-18) · Эффективность и удобство 15%. Весь раздел — **P1**.

#### 8.3.1. Что строим
Клиент звонит оператору, и у оператора три задачи:
- найти заявку клиента, чтобы отменить или перенести её;
- записать новую заявку в свободное временное окно;
- передать аварию диспетчеру.

Запись бэк встраивает в план дня сам (D-18). Аварию получает диспетчер как предложение.

| Экран | Роут | Что | Порядок |
|---|---|---|---|
| O-02 Найти заявку | `/operator` | поиск, карточка, отмена | 1 |
| O-01 Новая запись · обычная заявка | `/operator/new` | поля заявки, шаг 1 из 2 | 2 |
| O-01.2 Дата и окно | `/operator/new`, шаг 2 | даты, окна, запись | 2 |
| O-02.1 Перенос | `/operator/reschedule/:id` | раскладка O-01.2 для существующей заявки | 3 |
| O-01 Авария | `/operator/new?tab=emergency` | авария → диспетчеру | 4, только при ⏳ 9.1 |

**Не делаем:** подсказки адреса и геокодинг на фронте; «Позвонить клиенту»; причины занятых окон (D-22); выбор бригады оператором; фильтры в поиске.

#### 8.3.2. Файлы
```
src/api/booking.ts            searchRequests, getSlots, createBooking, cancelBooking, rescheduleBooking
src/api/events.ts             + applyOperatorEmergency (файл уже есть у диспетчера)
src/api/types.ts              + BookingSearchItem, BookingCancelBody, BookingMutationResult (§8.3.4)
src/adapters/booking.ts       normalizeSearchItem — безопасный доступ к полям ⏳ 9.2
src/lib/booking.ts            форматы и правила (§8.3.5)
src/lib/dictionaries.ts       + BK_REGULAR, HD_BY_BK (§8.3.7)
src/config.ts                 FEATURES: emergencyByRegion, cancelComment (§5.4)
src/features/operator/
  OperatorLayout.tsx          AppBar оператора: кнопка справа зависит от роута
  operatorTexts.ts            все строки §8.3.11
  useOperatorRegion.ts        регион по умолчанию, sessionStorage.operator_region
  search/    SearchPage, SearchResults, ResultRow, RequestCard, CancelBlock
  booking/   NewRequestPage, RequestTabs, RegularForm, EmergencyForm, useBookingForm (useReducer),
             SlotStep, DateStrip, SlotGrid, BookingSummary, SkillLine
  reschedule/ ReschedulePage   (переиспользует SlotStep, DateStrip, SlotGrid)
src/mocks/handlers.ts         + /booking/* и авария, фикстуры из снимка (§12, шаг 16)
```

#### 8.3.3. Роуты и состояние в URL
| Путь | Экран | Параметры |
|---|---|---|
| `/operator` | O-02 | `q` — строка поиска, `request=<id>` — выбранная заявка, `cancel=1` — раскрыт блок отмены |
| `/operator/new` | O-01 → O-01.2 | `tab=regular\|emergency` (по умолчанию `regular`) |
| `/operator/reschedule/:id` | O-02.1 | — |

- **Поля формы и шаг 1 / 2 — в состоянии страницы (`useBookingForm`), не в URL.** При уходе со страницы форма сбрасывается.
- `RequireRole('operator')`. Прямой заход на `/operator/reschedule/:id` без данных заявки: берём её из `GET /booking/requests?q=<id>` (первое точное совпадение по `request_id`). Нет совпадения — редирект на `/operator?q=<id>`.

#### 8.3.4. API

**Ручки**
| Функция | Запрос | Экран |
|---|---|---|
| `searchRequests(q)` | `GET /booking/requests?q` — `region_id` и `date` не передаём | O-02, O-02.1 |
| `getSlots(p)` | `GET /booking/slots?region_id&date&type_bk&type_hd&address&gigabit&required_transport` | O-01, O-01.2, O-02.1 |
| `createBooking(body)` | `POST /booking/requests` | O-01.2 |
| `rescheduleBooking(id, body)` | `POST /booking/requests/{id}/reschedule {new_date, new_window}` | O-02.1 |
| `cancelBooking(id, body)` | `POST /booking/requests/{id}/cancel {reason, comment?}` | O-02 |
| `applyOperatorEmergency(body)` | `POST /events/apply` (§8.3.9) | O-01 «Авария» |

- Оператору открыты только `/regions`, `/booking/*` и `/events/apply` для `urgent_order_added`.
- `/days`, `/planning`, `/data`, `/calendar` не вызываем.

**Типы**
`BookingSlotsResponse`, `BookingRequestIn`, `BookingRequestOut`, `BookingRescheduleIn` — из `schema.d.ts` (`components['schemas'][…]`). Для ответов без схемы — ручные типы:
```ts
// GET /booking/requests — в схеме нетипизированный массив
export interface BookingSearchItem {
  request_id: string; region_id: RegionId; date: string /* YYYY-MM-DD */; window: string /* "18:00-20:00" */;
  address: string; type_bk: string; type_hd?: string | null; status: RequestStatus;
  district?: string | null; gigabit?: boolean; technology?: 'FMC' | 'FTTB' | null;      // ⏳ 9.2
  required_transport?: Transport | null; engineer_name?: string | null;                 // ⏳ 9.2
}
export type CancelReason = 'client_refused' | 'booking_error' | 'other';
export interface BookingCancelBody { reason: CancelReason; comment?: string }            // comment ⏳ 9.3
// ответы /cancel, /reschedule, POST /booking/requests — поля сверх схемы
export interface BookingMutationResult {
  status?: string; message?: string;                                                     // ⏳ 9.4
  request_id?: string; date?: string; window?: string;                                   // у /reschedule ⏳ 9.4
}
```
`normalizeSearchItem` приводит `technology`, `gigabit`, `engineer_name` к `undefined`, если полей нет. Компоненты читают только нормализованную модель.

**Кэш, опрос, инвалидация**
| Ключ | Когда | Настройки |
|---|---|---|
| `['booking', 'search', q]` | `q.length ≥ 3`, debounce 300 мс | `staleTime: 10 000` |
| `['booking', 'slots', region, date, type_bk, type_hd, address, gigabit, transport]` | фон на шаге 1, шаг 2, перенос | на шаге 2 и в переносе `refetchInterval: 30 000`, `refetchOnWindowFocus: true`; на шаге 1 без опроса |

- После любой мутации инвалидируем `['booking', 'search']` и `['booking', 'slots']`.
- `refetchIntervalInBackground: false`, как везде (§5.1).

**Ошибки — только через `toApiError`**
| Код | Где | Реакция |
|---|---|---|
| 409 `SLOT_TAKEN` | запись, перенос | danger-плашка над кнопками (§8.3.11), выбор окна снят. Окна берём из `error.details.slots` ⏳ 9.5, иначе `refetch()` |
| 422 `COMMENT_REQUIRED` | отмена «Другое» | подсветка поля «Опишите причину» |
| 409 `ILLEGAL_TRANSITION` | отмена, перенос | тост с `message` ⏳ 9.9. Карточку обновляем: статус мог измениться |
| 409 / 422 в аварии | «Передать диспетчеру» | danger-плашка над кнопкой с `message` |
| 422 `VALIDATION_ERROR` | формы | тост «Проверьте заполнение полей» |
| сеть, 5xx | всё | `ErrorState` «Не удалось связаться с сервером» + «Повторить» или тост |

- Во время запроса кнопки в состоянии `loading`: двойное нажатие исключено.

#### 8.3.5. Общие правила

**AppBar (`OperatorLayout`)**
- Слева — логотип и «Маршруты инженеров».
- Справа:
  - на `/operator` — primary «Добавить заявку» (иконка `plus`) → `/operator/new`;
  - на `/operator/new` и `/operator/reschedule/:id` на её месте — secondary «Найти заявку» (иконка `search`) → `/operator`;
  - имя пользователя, под ним «Оператор поддержки», «Выйти» (§8.1).

**Регион**
- SegmentedControl «Восток · Юго-восток · Югоцентр». Названия — из `GET /regions`, только регионы из `user.region_ids`. У оператора все 3 (D-22).
- По умолчанию — последний выбранный (`sessionStorage.operator_region`), иначе первый из `region_ids`.
- Один регион → вместо SegmentedControl текст с названием.

**`lib/booking.ts`**
| Функция | Пример |
|---|---|
| `windowShort('14:00-16:00')` | «14–16» |
| `windowFull('14:00-16:00')` | «14:00–16:00» |
| `dateShort('2026-09-30')` | «30.09» |
| `dateWithWeekday('2026-09-29')` | «Вт, 29.09» (date-fns, `ru`) |
| `typeShort(bk, hd)` | Подключение «Подключение» · Локальная заявка «Локальная» · Дозаказ «Дозаказ» · Глобальная проблема — «Авария» при HD «Авария», «Информация» при HD «Информация» (D-37) |
| `typeFull(bk, hd)` | «Подключение · Конвергенция абонента»; нет HD — только BK |
| `phoneInput(raw)` | маска «+7 (916) 123-42-18» при вводе |
| `phoneToApi(raw)` | «+79161234218»; пусто → `undefined` |
| `phoneMasked('+79161234218')` | «+7 916 ••• 42 18» |
| `requiredTransportByRule(hd, gigabit)` | `'car'`, если HD «Работа с кабелем» или `gigabit`, иначе `null` (`ML_SPEC` §2) |
| `defaultHd(bk)` | первая строка `HD_BY_BK[bk]` |
| `next14Days(today)` | 14 дат с сегодняшней |
| `todayMsk()` | реальная дата Europe/Moscow |

- Часы дня (`clock`) оператору недоступны, «сегодня» — реальная дата [Д].

#### 8.3.6. O-02 Найти заявку — `/operator`
**Левая карточка «Найти заявку» (520 px)**
- Поле с иконкой `search`, плейсхолдер «№ заявки или адрес», ✕ очищает поле. От 3 символов, debounce 300 мс → `searchRequests(q)`.
- Под полем — «По № заявки или адресу · найдено N». При 20 результатах: «Показаны первые 20 — уточните запрос».
- **Строка результата:**
  - «№{request_id}» и `StatusChip` (sm);
  - адрес;
  - «{dateShort} · окно {windowShort} · {typeShort}»;
  - порядок — по дате, новые сверху [Д];
  - выбранная строка — белая с рамкой 2 px `--text-primary`, остальные — на `--bg-nested`. Клик → `request=<id>`.
- **Состояния:**

| Условие | Слева | Справа |
|---|---|---|
| `q` короче 3 символов | «Введите № заявки или адрес» | «Выберите заявку слева» |
| загрузка | 3 скелетона строк | — |
| пусто | «Ничего не нашли. Проверьте номер или адрес» | «Выберите заявку слева» |
| ошибка | `ErrorState` + «Повторить» | — |

**Правая карточка заявки**
- **Шапка:** «№{request_id}» (H2) и `StatusChip`.
- **Серый блок, 2 колонки:**

| Подпись | Значение |
|---|---|
| Дата и окно | «{dateWithWeekday} · {windowFull}» |
| Тип | `typeFull(bk, hd)` |
| Адрес | полностью, с квартирой |
| Район | `district` ⏳ 9.2 |
| Гигабит | «да» / «нет» ⏳ 9.2 |
| Инженер | `engineer_name` ⏳ 9.2; `null` → «не назначен» |

  Поля, которых нет в ответе, не выводим.
- **Кнопки** — у любой найденной заявки, как в макете: tertiary «Перенести» (иконка `calendar-clock`) → `/operator/reschedule/:id`; danger «Отменить».
  - Статусы на фронте не фильтруем (О-5 отклонено).
  - Можно ли отменить или перенести, решает бэк. Отказ → тост с `message` (⏳ 9.9).

**Блок «Отменить заявку?»** — в карточке, под кнопками (`cancel=1`)
| Радио | Тело |
|---|---|
| Клиент отказался — выбрано по умолчанию | `{reason: 'client_refused'}` |
| Ошибка записи | `{reason: 'booking_error'}` |
| Другое → поле «Опишите причину», обязательно | `{reason: 'other', comment}` ⏳ 9.3. Флаг `cancelComment = false` → строку не показываем |

- Выбранное радио — белое с рамкой 2 px, как в макете.
- Кнопки: ghost «Назад» (закрывает блок) · danger «Отменить заявку» (иконка `x-circle`). Для «Другое» с пустым полем кнопка неактивна.
- **Успех:**
  - тост — `message` из ответа ⏳ 9.4;
  - без него: дата заявки позже сегодня → «Заявка отменена. План на {dateShort} пересчитан»; дата — сегодня → «Заявка отменена. Чем занять освободившееся окно, решит диспетчер»;
  - блок закрываем, поиск и карточку обновляем.

#### 8.3.7. O-01 Новая запись · обычная заявка — `/operator/new`
**Карточка по центру, 760 px**
- Шапка: «Новая запись», справа «Шаг 1 из 2».
- Вкладки «Обычная заявка» (иконка `file-plus`) · «Авария» (`zap`) → `tab`. «Авария» скрыта, если `emergencyByRegion = false` (§5.4).
- **Поля, сетка 2 колонки:**

| Поле | Контрол | Обязательно | В запрос |
|---|---|---|---|
| Регион | SegmentedControl (§8.3.5), на 2 колонки | да | `region_id` |
| Адрес | input на 2 колонки, иконка `map-pin`. Справа район, если бэк вернул `district` в окнах ⏳ 9.7 | да, от 5 символов | `address`, `district?` |
| Тип заявки BK | select, иконка `list`: Подключение · Локальная заявка · Дозаказ · Глобальная проблема (только HD «Информация», D-37) | да | `type_bk` |
| Тип заявки HD | select, иконка `list-tree`, список по BK; при смене BK → `defaultHd(bk)` | да | `type_hd` |
| Контакт клиента · необязательно | input, иконка `phone`, маска `phoneInput` | нет; если заполнено — 11 цифр | `client_contact` |
| Требуемый транспорт | select, иконка `circle-slash` / `car`: Не требуется · Автомобиль · Общественный транспорт · Пешком · Велосипед | — | `required_transport` (`null` — «Не требуется») |
| Гигабит | Switch | — | `gigabit` |
| Технология | FMC / FTTB, только регион Восток, по умолчанию FMC | — | `technology`; другие регионы — `null` |

- **Списки HD** (`HD_BY_BK`, строки из выданных CSV, первая — самая частая):
  - **Подключение:** Конвергенция абонента · Заявка на подключение · Заказ подключения/Дозаказ оборудования;
  - **Локальная заявка:** Нет линка · Работа с кабелем · Переключение на Гбит/с · IP-адрес 169... · Разрывы · Рост ошибок на порту · Низкая скорость · Роутер. Замена техническим специалистом · TVE/ENT. Замена приставки техником · ТВ. Замена приставки техником · TVE/ENT. Другие ошибки · Мониторинг;
  - **Дозаказ:** Дозаказ оборудования · Заказ подключения/Дозаказ оборудования · Конвергенция абонента;
  - **Глобальная проблема:** в обычной заявке — только «Информация»; «Авария» — только во вкладке «Авария» (D-37).
- **Требуемый транспорт по правилу:**
  - пока оператор не менял поле сам, значение = `requiredTransportByRule(hd, gigabit)`;
  - при `'car'` справа подпись «по правилу»;
  - после ручного выбора правило поле больше не трогает (`transportTouched = true`).
- **Строка навыка** под полями (иконка `wrench`): «Навык: {required_skill_display} · {duration_minutes} мин на адресе».
  - Данные — из фонового `getSlots` на дату по умолчанию для шага 2. Запрос уходит, когда выбраны регион, BK и HD; debounce 300 мс.
  - Подпись навыка — по словарю §10.1.
  - До ответа и при ошибке строки нет.
- **Primary «Выбрать дату и окно»** (иконка `arrow-right`) → шаг 2. Неактивна, пока обязательные поля не заполнены.

#### 8.3.8. O-01.2 Дата и окно — шаг 2
**Слева — карточка «Новая запись» (420 px)**
- Справа в шапке — ghost «Изменить» (`pencil`) → шаг 1, поля сохранены.
- **Сводка на `--bg-nested`:**
  - Регион;
  - Адрес · район;
  - Тип — `typeFull`;
  - Технология — «FMC · без гигабита» / «FMC · с гигабитом»; нет технологии — «Гигабит: да / нет»;
  - Контакт клиента — `phoneMasked`; пусто — строки нет;
  - Требуемый транспорт.
- Под сводкой — строка навыка.

**Справа — «Дата и окно»,** подпись «Шаг 2 из 2 · свободные окна обновляются»
- **Лента дат** — `next14Days(todayMsk())`, пилюли 56 px: день недели и число.
  - По умолчанию — завтра [Д]; выбранная — `--bg-inverse`, белый текст.
- **Сетка окон** — 3 в ряд, карточки 104 px, строим из `slots[]` ответа (6 окон не зашиваем):

| `available` / выбор | Вид | Подпись |
|---|---|---|
| `true` | белая, рамка `--bg-control-track`, hover — тёмная рамка | «свободно» |
| `true`, выбрано | `--bg-inverse`, белый текст | «выбрано» |
| `false` | `--bg-nested`, текст `--text-tertiary`, не кликается | «занято» |

  - В карточке — `windowShort` крупно (700 24/32). `reason` и `reason_code` не показываем (D-22).
- **Обновление окон:** при смене даты — сразу; дальше каждые 30 с и при возврате на вкладку браузера. Выбранное окно стало `available: false` → выбор снимаем.
- **Состояния сетки:** загрузка — 6 скелетонов; все заняты — «На {dateShort} свободных окон нет. Выберите другую дату»; ошибка — «Не удалось загрузить окна» + «Повторить».
- **Кнопки внизу справа:** ghost «Назад» (`arrow-left`, как «Изменить») · primary «Записать на {windowFull}» (`calendar-check`). Без выбранного окна primary неактивна с текстом «Выберите окно».
- **«Записать»** → `createBooking`:
```ts
{ region_id, date, window /* '14:00-16:00' как в slots */, type_bk, type_hd, address, district,
  gigabit, technology, required_transport, client_contact: phoneToApi(contact) }
```
- **Ответ:**

| Ответ | Тост (тёмный, иконка `circle-check`) |
|---|---|
| `status: 'planned'` | `message` ⏳ 9.4 ?? «Заявка №{request_id} записана на {dateShort}, {windowShort}. План дня пересчитан» |
| `status: 'unassigned'` | `message` ?? «Заявка №{request_id} записана на {dateShort}, {windowShort}. Инженера назначит диспетчер» |
| HTTP 202 `{status: 'recalculating'}` | «Заявка записана на {dateShort}, {windowShort}. План дня пересчитывается» |
| 409 `SLOT_TAKEN` | тоста нет. Danger-плашка «Это окно только что заняли. Выберите другое» (иконка `circle-alert`), окна обновлены, выбор снят. Плашка исчезает при выборе окна |

- **После успеха:**
  - тост с secondary «Новая запись» висит, пока его не закроют;
  - primary — неактивная «Записано», «Назад» и «Изменить» скрыты;
  - «Новая запись» → пустой шаг 1, регион сохраняется.

#### 8.3.9. O-01 Авария — вкладка «Авария» · только при ⏳ 9.1
- Шапка карточки без «Шаг 1 из 2».
- **Поля, сетка 2 колонки:**
  - Регион (иконка `map`);
  - Тип заявки HD (`zap`): «Авария», поле только для чтения (D-37);
  - Адрес на 2 колонки (`map-pin`) — свободный текст, обязательно;
  - Требуемый транспорт на 2 колонки (`car`) — по умолчанию «Автомобиль»;
  - Комментарий — textarea 96 px, необязательно.
- Плашка (иконка `info`): «Аварию распределит диспетчер — дата и окно не нужны».
- **Primary «Передать диспетчеру»** (`send`) → `applyOperatorEmergency`:
```ts
{ type: 'urgent_order_added', source: 'operator', apply: false,
  params: { region_id, comment: comment || undefined },          // ⏳ 9.1; plan_id и event_time не шлём
  request: { id: `U-${Date.now().toString(36).toUpperCase()}`, address, duration_minutes: 80,
             window_start: nowMsk(), window_end: '22:00',        // обязательны по схеме; для оператора окно ставит бэк ⏳ 9.1
             priority: 'urgent', required_skill: 'emergency', required_transport: transport ?? 'car',
             type_bk: 'Глобальная проблема', type_hd: 'Авария', source: 'operator' } }
```
- **Успех** → тост «Авария передана диспетчеру. Он получит предложение, кто поедет». Форма очищается, регион остаётся.
- **409 / 422** → danger-плашка над кнопкой с `message`, например: «Рабочий день в регионе Восток ещё не начат — аварию примет диспетчер».

#### 8.3.10. O-02.1 Перенос — `/operator/reschedule/:id` (макета нет, раскладка O-01.2)
- **Слева — карточка «Перенос заявки №{id}»:** сводка из `BookingSearchItem` — Дата и окно сейчас · Тип · Адрес · Район ⏳. Кнопки «Изменить» нет.
- **Справа — тот же `SlotStep`,** над сеткой строка «Сейчас: {dateShort}, {windowShort}». Дата по умолчанию — дата заявки, если она не раньше сегодня, иначе завтра.
- **Окна** — `getSlots` по полям заявки: `type_bk`, `type_hd`, `address`, `gigabit ?? false`, `required_transport` (если есть).
- **Кнопки:** ghost «Назад» → `/operator?request=<id>` · primary «Перенести на {windowFull}».
- **«Перенести»** → `rescheduleBooking(id, {new_date, new_window})`.
- **Успех** → `/operator?request=<result.request_id ?? id>` + тост: `message` ⏳ 9.4 ?? «Заявка №{id} перенесена на {dateShort}, {windowShort}».
- **`SLOT_TAKEN`** — как в O-01.2; `ILLEGAL_TRANSITION` — тост с `message`, возврат в поиск.

#### 8.3.11. Тексты (`operatorTexts.ts`)
| Ключ | Текст |
|---|---|
| `search.title` | Найти заявку |
| `search.placeholder` | № заявки или адрес |
| `search.hint` | По № заявки или адресу · найдено {N} |
| `search.limit` | Показаны первые 20 — уточните запрос |
| `search.empty` | Введите № заявки или адрес |
| `search.notFound` | Ничего не нашли. Проверьте номер или адрес |
| `card.none` | Выберите заявку слева |
| `card.engineerNone` | не назначен |
| `cancel.title` | Отменить заявку? |
| `cancel.reasons` | Клиент отказался · Ошибка записи · Другое |
| `cancel.comment` | Опишите причину |
| `cancel.doneFuture` | Заявка отменена. План на {DD.MM} пересчитан |
| `cancel.doneToday` | Заявка отменена. Чем занять освободившееся окно, решит диспетчер |
| `new.title` / `new.step1` / `new.step2` | Новая запись / Шаг 1 из 2 / Шаг 2 из 2 · свободные окна обновляются |
| `new.tabs` | Обычная заявка · Авария |
| `new.skill` | Навык: {навык} · {N} мин на адресе |
| `new.byRule` | по правилу |
| `new.next` | Выбрать дату и окно |
| `slots.title` | Дата и окно |
| `slots.free` / `slots.busy` / `slots.selected` | свободно / занято / выбрано |
| `slots.none` | На {DD.MM} свободных окон нет. Выберите другую дату |
| `slots.error` | Не удалось загрузить окна |
| `slots.taken` | Это окно только что заняли. Выберите другое |
| `slots.pick` | Выберите окно |
| `book.cta` / `book.done` | Записать на {HH:MM–HH:MM} / Записано |
| `book.okPlanned` | Заявка №{id} записана на {DD.MM}, {окно}. План дня пересчитан |
| `book.okUnassigned` | Заявка №{id} записана на {DD.MM}, {окно}. Инженера назначит диспетчер |
| `book.okRecalc` | Заявка записана на {DD.MM}, {окно}. План дня пересчитывается |
| `book.again` | Новая запись |
| `resch.title` / `resch.now` / `resch.cta` | Перенос заявки №{id} / Сейчас: {DD.MM}, {окно} / Перенести на {HH:MM–HH:MM} |
| `resch.ok` | Заявка №{id} перенесена на {DD.MM}, {окно} |
| `crash.note` | Аварию распределит диспетчер — дата и окно не нужны |
| `crash.cta` | Передать диспетчеру |
| `crash.ok` | Авария передана диспетчеру. Он получит предложение, кто поедет |
| `net.error` | Не удалось связаться с сервером |

#### 8.3.12. Проверка

**Юнит-тесты (vitest)**
- `lib/dictionaries.ts`: `isEmergency` — HD «Авария» → да; BK «Глобальная проблема» + HD «Информация» → нет; нет HD, BK «Глобальная проблема» → да; нет BK и HD, навык `emergency` → да. `typeShort` для «Информации» → «Информация».
- `lib/booking.ts`: `windowShort`, `dateWithWeekday` (29.09.2026 → «Вт, 29.09»), `phoneMasked`, `phoneToApi`, `requiredTransportByRule` (кабель → car, гигабит → car, прочее → null), `defaultHd`, `next14Days`.
- `adapters/booking.ts`: строка без полей 9.2 → `district`, `gigabit`, `engineer_name` не определены, компонент их не выводит.
- `useBookingForm`: смена BK сбрасывает HD на `defaultHd`; ручной выбор транспорта не перезаписывается правилом; окно стало занятым → выбор снят.
- Тело отмены: «Другое» без комментария не отправляется.

**Моки (msw)**
- Фикстуры `booking-slots.json`, `booking-search.json` — из снимка (§12, шаг 16).
- Ручные обработчики: `POST /booking/requests` → `planned` / 409 `SLOT_TAKEN` (переключатель в моке); `/cancel`, `/reschedule` → `{status, message}`; `/events/apply` → `ReplanResult` со `status: 'proposed'`.

**Приёмка на стенде**
**Записи на стенде меняют план дня.** Проверяем на Востоке на дату **сегодня + 13 дней**, после проверки отменяем. Демо-день Востока (сегодня) не трогаем.

1. Вход `operator` → `/operator`, «Введите № заявки или адрес»; в AppBar — «Добавить заявку», имя, «Оператор поддержки», «Выйти».
2. «Добавить заявку» → Восток, адрес, Подключение → HD «Конвергенция абонента». Появилась строка «Навык: Подключение и дозаказ · N мин на адресе». Включаем «Гигабит» → транспорт «Автомобиль · по правилу».
3. «Выбрать дату и окно» → дата +13 → свободное окно → «Записать на …». Тост с № и «План дня пересчитан», primary — «Записано».
4. «Найти заявку» → ищем по № → карточка, статус «Запланирована».
5. «Перенести» → другое окно → «Перенести на …» → тост, в карточке новое окно.
6. «Отменить» → «Ошибка записи» → «Отменить заявку» → тост, статус «Отменена».
7. «Отменить» у отменённой заявки → тост с текстом бэка, без падения.
8. На моках: `SLOT_TAKEN`, 202, авария (если `emergencyByRegion`).
9. В консоли нет ошибок, `npm run check` и `npm test` зелёные.

---

## 9. Инженер — итоговое ТЗ (по макету `design/Engineer.html`, 28.09)
Вёрстка — по макету. При расхождении макета с этим разделом прав раздел: решения Р-1…Р-16 — в `ENGINEER_SPEC_REVIEW_28-09.md`, D-30…D-32. Правки бэка — `BACKEND_FIXES_FINAL_28-09.md` §8, флаги — §5.4. Порядок работ — §17.2.

### 9.1. Общее
- **Роуты:**
  - `/engineer?view=list|map` — E-01…E-04 и E-10 по состоянию дня;
  - `/engineer/request/:id` — E-03.1 / E-05;
  - шторки E-02, E-06, E-07, E-08 — query `sheet=transport|interrupt|incident|unavailable`, не роуты.
- Ширина 360–430 px, область касания ≥ 44 px, действия внизу экрана.
- **Шапка 56 px:** логотип, `engineer.name`, меню ⋯. На E-03.1 слева «←».
- **Меню ⋯** (D-31):
  - «Не могу работать» — при `on_shift`;
  - «Завершить смену» — при `on_shift`, если нет заявок `en_route` / `in_progress`;
  - «Выйти».
- **Данные:** `GET /engineers/me/day`, опрос 15 с. Ответ любого действия (`EngineerActionOut.day`) сразу кладём в кэш `engineerDay`.
- Поля `/me/day`, которых нет в схеме (`date`, `plan_published`, `clock`, `shift_totals`, `engineer.start`), сверяем со снимком. Где поля нет — запасные пути ниже.

**Состояния страницы**

| Условие | Экран |
|---|---|
| загрузка | скелетоны карточки и 4 строк |
| ошибка сети | «Не удалось связаться с сервером» + «Повторить» |
| `plan_published = false` | «План на сегодня ещё не опубликован. Он появится, когда диспетчер начнёт рабочий день» |
| `visits` пуст | «На сегодня заявок нет» |
| `shift_status = not_started` | E-01 |
| `on_shift` | E-03 «Список» / E-04 «Карта» |
| `unavailable` | E-03 без кнопок; заявку «В работе» можно выполнить. Сверху баннер из `banners[]`, иначе «С {available_until} ваши заявки передадут другим после решения диспетчера» |
| `finished` | E-10 |

**Текущая заявка** (`currentVisit`, D-30): `active_request_id`, иначе первая по `sequence` в статусе `planned`. Заявки `cancel_pending` / `reschedule_pending` текущими не бывают. Начать можно только текущую.

**Подписи** (`lib/engineerLabels.ts`, D-32)
- **Заголовок** — `type_hd ?? type_bk ?? подпись по навыку` (§6.8).
- **Номер** — в строках `shortId` («…1402»), в карточках полный («№305871402»).
- **Адрес** — в строках без «Город Москва, » и квартиры, в карточке полностью.
- **Окно** — в строках «14–16», в карточке «14:00–16:00» (`parseWindow`).
- **Оборудование** — только из поля `equipment` визита ⏳. Нет поля — блок не выводим, модели не придумываем.

### 9.2. Экраны
**E-01 Превью до начала смены · P1**
- «Список / Карта». Карта — только просмотр маршрута на день.
- **Карточка:** «Сегодня, {d MMMM}» · «{summary.total} заявок, первая в {first_start}» · «Старт: {офис | дом}, {start.address}».
- **Лента по времени:** слева время прибытия; в карточке — заголовок, «Срочная», «Прибытие ≈ {arrival} · {duration} мин · окно {окно}», адрес, оборудование.
- **Внизу:** primary «Начать смену» → E-02; danger «Не выйду сегодня» → шторка E-08 без поля времени.

**E-02 «На чём сегодня?» · P1**
- 4 варианта: Автомобиль · Общественный транспорт · Пешком · Велосипед. По умолчанию выбран `engineer.transport`, у него подпись «по справочнику».
- Выбран не справочный → плашка «Заявки, где нужен автомобиль, передадут другим инженерам после решения диспетчера».
- «Поехали» → `shift_start {payload: {transport}}`. Бэк сам создаёт `transport_changed` для диспетчера.

**E-03 Мои заявки · P0** (макеты E-03, E-03.2, E-03.3)
- «Список / Карта».
- **Карточка текущей:**
  - «ТЕКУЩАЯ · {sequence} ИЗ {summary.total}»;
  - заголовок, StatusChip, флаги;
  - адрес;
  - «№… · окно … · {время}»: `planned` — «приезд ≈ {arrival}», `en_route` / `in_progress` — «начало {start}»;
  - оборудование.
- **Панель статуса:**

| Статус текущей | Primary | Под ней |
|---|---|---|
| `planned` | «Отправиться в путь» → `en_route` | «Инцидент» ⏳ · «Прервать» |
| `en_route` | «Взять в работу» → `start` | то же |
| `in_progress` | «Выполнить задачу» → `complete` | то же |

  - Нет `incident` в API → «Прервать» на всю ширину.
  - «Взять в работу» раньше окна не блокируем: бэк ставит флаг «Начата раньше окна» (D-09).
- **После «Выполнить задачу»:**
  - тост успеха (белая карточка, зелёная иконка, 4 с): «Заявка №… выполнена» и «{actual_start}–{actual_end} ⏳ · следующая — {адрес}, {leg_km} км». Нет фактического времени — вторая строка без него;
  - текущей становится следующая.
- **«Далее по маршруту»:**
  - сначала ждущие решения: чип «Отменяется» / «Переносится», подпись «Ждёт решения диспетчера» (Р-1: инженер не застревает на такой заявке);
  - затем `planned` по `sequence`;
  - строка: кружок с `sequence` цветом маршрута, время `arrival`, адрес, «{заголовок} · окно {окно}», чипы «Изменено» / «Срочная», иконки прочих флагов, «›» → `/engineer/request/:id`.
- **«Завершённые · N»** — свёрнуто: `done`, `cancelled`, `rescheduled`. Строка — ✓ или чип статуса, адрес, время.
- **Все заявки закрыты** → вместо карточки текущей «Все заявки на сегодня закрыты» и primary «Завершить смену».

**E-03.1 / E-05 Карточка заявки · P1** — `/engineer/request/:id`
- «СЛЕДУЮЩАЯ · {sequence} ИЗ {total}» (для текущей — «ТЕКУЩАЯ»), заголовок, StatusChip, флаги, адрес.
- **Серый блок:** Номер · Тип (`type_bk`) · Район · Окно · Приезд · начало · Длительность · Гигабит · Технология. Пустые поля не выводим.
- Оборудование; «**Почему это вам:** {why_you}».
- **Низ по статусу:**
  - текущая — панель статуса E-03;
  - запланированная — плашка «Начать можно после завершения текущей заявки №…» и tertiary «Маршрут в Яндекс Картах»: от старта `/me/route` через точки до этой заявки;
  - закрытая — без кнопок.
- Открытие карточки снимает флаг «Изменено» локально (`seen_changed_<id>`).

**E-04 Карта · P1**
- `GET /engineers/me/route?remaining=true` → полилиния `geometry.coordinates` (`[lon, lat]`) + маркеры `points`. После `complete` запрос обновляется.
- Цвет маршрута — §10.2.
- **Шторка:** текущая в пути / в работе → «ТЕКУЩАЯ · В ПУТИ» / «ТЕКУЩАЯ · В РАБОТЕ»; иначе «СЛЕДУЮЩАЯ · К {arrival}».
- Кнопки «До следующей» и «Маршрут на день», подпись «Откроется в Яндекс Картах».
- **Яндекс Карты** — `lib/yandexMaps.ts`:
```ts
const RTT: Record<Transport, string> = { car: 'auto', public_transport: 'mt', walk: 'pd', bike: 'bc' };
export function yandexRouteUrl(start: LatLon, points: LatLon[], transport: Transport): string {
  const pts = [start, ...points].slice(0, 20).map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('~');
  return `https://yandex.ru/maps/?rtext=${pts}&rtt=${RTT[transport]}`;
}
```
  - «До следующей» — `points.slice(0, 1)`; «Маршрут на день» — все `points`; из E-03.1 — `points` до выбранной заявки включительно.
  - Транспорт — `actual_transport ?? transport`.
  - Открываем через `<a target="_blank" rel="noopener">`.
  - [Г] Проверить на iPhone и Android, открывается ли приложение Карт. Запасной вариант — `yandexmaps://maps.yandex.ru/?rtext=…&rtt=…`.

**E-06 «Прервать выполнение» · P0**
- Шапка «Прервать выполнение», «№… · {адрес без квартиры}».
- **Радио → `fail`:**

| Строка | `payload` |
|---|---|
| Клиент отказался | `{reason: 'client_refused'}` |
| Нет доступа или техническая причина | `{reason: 'no_access'}` [Д] |
| Клиент просит перенести | `{reason: 'client_reschedule', desired_date}` — поле «Желаемая дата»: с завтра до +14 дней, обязательно |
| Другое | `{reason: 'other', comment}` — поле «Опишите причину», обязательно ⏳ |

- «Отправить диспетчеру» → тост «Отправлено диспетчеру. Можно ехать к следующей заявке». Заявка уходит первой строкой в «Далее» с чипом «Отменяется» / «Переносится», текущей становится следующая (D-30).
- `COMMENT_REQUIRED` → подсветка поля «Опишите причину».

**E-07 «Инцидент» · P1 ⏳** — показываем, только если в `/openapi.json` появилось действие `incident`. Доступен в любом активном статусе текущей заявки (D-31).
- «Сломался транспорт» + «Выберите новый транспорт: …» → `{reason: 'transport_broken', new_transport}`.
- «Не могу продолжить работу» → `{reason: 'cannot_continue'}`.
- «Другое» + текст → `{reason: 'other', comment}`.
- «Сообщить диспетчеру» → тост «Сообщили диспетчеру».
- Без `incident` «Не могу продолжить» доступно через меню ⋯ → «Не могу работать».

**E-08 «Не могу работать» / «Не выйду сегодня» · P1**
- «С какого времени»: «Сейчас · {nowFor(clock)}» или время шагом 15 мин до `shift_end`. В «Не выйду сегодня» поля нет.
- **Причина:** «Плохое самочувствие» → `sick` · «Семейные обстоятельства» → `family` · «Без причины» → без `reason`.
- Плашка «Текущую заявку доделайте. Остальные передадут другим инженерам после решения диспетчера».
- «Сообщить» → `unavailable {from: 'now' | 'HH:MM', reason?}`.

**E-09 Баннер «План изменён» · P0**
- Источник — `banners[]`. Показываем самый свежий непросмотренный. Баннер появляется только после решения диспетчера (D-30); сразу после действия инженера — тост.
- Тёмная плашка под шапкой: «План изменён», `text`, «Посмотреть».
- «Посмотреть» → карточка `request_id` (нет `request_id` — прокрутка к списку) и отметка `seen_banner_<at>_<type>` в localStorage. Следующий баннер — после этого.
- Тексты (`DESIGN_SPEC` §7.4) присылает бэк ⏳, фронт их не собирает.

**E-10 Итоги смены · P1**
- По `shift_totals`: выполнено X из N, начато в окне, пробег, прервано, в дороге, в работе, в ожидании (в «ч мин»).
- Подзаголовок «{started_at}–{ended_at}» ⏳, иначе «{дата} · смена {shift_start}–{shift_end}».
- Кнопка «Выйти» — secondary.
- Нет `shift_totals` → «Выполнено» и «Прервано» считаем по визитам, остальные — «—».

**«Завершить смену» · P1** — из меню или кнопкой на E-03 (D-31).
- Нет заявок `planned` → сразу `shift_end`.
- Есть → подтверждение «Осталось N заявок. Они вернутся диспетчеру» → `shift_end`.
- При `en_route` / `in_progress` пункт неактивен (бэк вернёт 409).

### 9.3. Действия → API
`POST /engineers/me/actions {action, request_id?, payload?}`, `at` не шлём (§7).

| Кнопка | `action` | `request_id` | `payload` |
|---|---|---|---|
| «Поехали» (E-02) | `shift_start` | — | `{transport}` |
| «Отправиться в путь» | `en_route` | текущая | — |
| «Взять в работу» | `start` | текущая | — |
| «Выполнить задачу» | `complete` | текущая | — |
| «Прервать» | `fail` | текущая | см. E-06 |
| «Инцидент» ⏳ | `incident` | текущая | см. E-07 |
| «Не могу работать» / «Не выйду сегодня» | `unavailable` | — | `{from, reason?}` |
| «Завершить смену» | `shift_end` | — | — |

- Кнопки в состоянии `loading` до ответа — двойное нажатие исключено.
- `409 ILLEGAL_TRANSITION` → откат оптимистичного статуса и тост с `message`.
- `delay` не используем (D-14), геолокации нет.
- **Окно** в `EngineerVisit.window` — строка `"10:00-12:00"`, парсим в `lib/time.ts`.
- **Флаг «Изменено»** снимаем локально после открытия карточки: ключ `seen_changed_<request_id>` в localStorage.

---

## 10. Общие модули
### 10.1. `lib/statuses.ts`, `lib/dictionaries.ts`, `lib/engineerLabels.ts`
Подписи и тона — строго `DESIGN_SPEC` §5 и §2.4:
- **Статусы:** `unassigned` Не назначена · `planned` Запланирована · `en_route` В пути · `in_progress` В работе · `done` Выполнена · `cancel_pending` Отменяется · `cancelled` Отменена · `reschedule_pending` Переносится · `rescheduled` Перенесена.
- **Флаги:** `urgent` Срочная · `at_risk` Под угрозой · `late` Просрочена · `changed` Изменено · `started_early` Начата раньше окна · `reaction_late` Реакция > 2 ч.
- **Навыки и транспорт:** `*_display` с бэка, если пришли; иначе словарь:
  - навыки: `local` Локальные работы · `installation` Подключение и дозаказ · `emergency` Аварийные работы;
  - транспорт: `car` Автомобиль · `public_transport` Общественный транспорт · `walk` Пешком · `bike` Велосипед.
- **Авария** — `isEmergency(r)` в `lib/dictionaries.ts` (D-37): есть `type_hd` → `type_hd === 'Авария'`; нет HD, есть BK → BK «Глобальная проблема»; нет BK и HD (синтетика) → навык `emergency`. По нему — красный маркер `zap`, сокращение «Авария», стиль блока аварии. Чип «Срочная» и флаг «Реакция > 2 ч» — только из флагов бэка.
- **Тип заявки без `type_bk`** (синтетика, §6.8) — по навыку: `emergency` «Авария» · `installation` «Подключение и дозаказ» / «Подкл.» · `local` «Локальные работы» / «Лок.».
- **Помощники подписей:** `shortId(id)`, `engineerLabel(name, id)` («Бригада X»), `engineerShort(name, id)` (без «Бригада») — в `lib/dictionaries.ts`.
- **Подписи инженера** — `lib/engineerLabels.ts` (§9.1):
  - `visitTitle(v)` — `type_hd ?? type_bk ?? подпись по навыку`;
  - `shortAddress(a)` — без «Город Москва, » и квартиры;
  - `windowShort('14:00-16:00')` → «14–16», `windowFull` → «14:00–16:00».
- **Регионы:** `east` Восток · `south_east` Юго-восток · `south_center` Югоцентр.

### 10.2. `lib/colors.ts`
- 12 цветов маршрутов из `DESIGN_SPEC` §2.5. Цвет инженера = индекс в ростере региона, отсортированном по `id`, по модулю 12. Если бригад больше 12, у повторного цвета линия маршрута пунктиром.
- **У инженера** ростера нет: цвет `--route-1` для всех [Д], пока бэк не отдаст `engineer.color_index` ⏳. С ним — `ROUTE_COLORS[color_index % 12]`, как у диспетчера (D-32).

### 10.3. `lib/time.ts`
- `nowMsk()` — через `Intl.DateTimeFormat('ru-RU', {timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit'})`.
- `nowFor(clock)`, `toMin` / `fromMin`, `parseWindow('10:00-12:00')`.
- Для таймлайна: `x = (toMin(t) − axisStart) / (axisEnd − axisStart) × width`, где `axisStart` — min `shift_start` бригад дня, округлённый вниз до часа, `axisEnd` — max `shift_end`, округлённый вверх. Константы 10:00 / 22:00 в коде не используем.

---

## 11. Качество
| Требование | Как проверить |
|---|---|
| `npm run check` (tsc + eslint) без ошибок | перед каждым коммитом |
| Юнит-тесты адаптеров §6 на фикстурах `docs/api-examples` (vitest) | `npm test` |
| Запуск по README | `npm i && npm run dev`; прод — `npm run build` + статический сервер |
| Стенд | `VITE_API_URL=https://api.bee-dynasty.ru/api/v1`, CORS ⏳ |
| Производительность | первая отрисовка дня < 2 с; строки таймлайна — `React.memo` |
| Доступность | фокус-кольцо, `aria-label` у иконок, статусы не только цветом, область касания на мобильном ≥ 44 px |
| Секреты | пароли демо-учёток только в `.env.local` (в `.gitignore`); в localStorage — только токен и UI-мелочи |

---

## 12. Шаг 0 — снимок живого API (первым делом, ~30 мин)
Чтобы адаптеры и моки не гадали о форме ответов «без схемы».

1. `.env.local` (не коммитить):
```
API_URL=https://api.bee-dynasty.ru/api/v1
DEMO_DISPATCHER=dispatcher
DEMO_OPERATOR=operator
DEMO_ENGINEER=eng-east-01
DEMO_PASSWORD=<пароль из гайда бэка>
```
2. `scripts/snapshot-api.mjs` (Node 18+, `fetch`):
   - логинится тремя ролями и сохраняет ответы в `docs/api-examples/<name>.json`;
   - **работает на отдельном тестовом дне** (`load-demo` на дату через 30 дней, регион Восток), чтобы не трогать демо-день и не упереться в записи оператора;
   - после события делает `reject` предложения.

   Порядок вызовов:
   1. `GET /regions`;
   2. `POST /data/load-demo?region_id=east&date=<сегодня + 30 дней>` → `scenario_id`;
   3. `GET /data/scenarios/{id}`; `POST /planning/compare {scenario_id, strategies: ['fifo','dispatcher']}` (до плана);
   4. `POST /planning/run` → `plan_id`;
   5. `GET /planning/{plan_id}`;
   6. `GET /visualization/{plan_id}/geojson?geometry=road`;
   7. `POST /planning/compare`; `POST /planning/baseline {plan_id}`; `GET /planning?scenario_id`; `POST /planning/{plan_id}/extend-resource {order_ids: <неназначенные>, option: 'add_engineer'}` (если есть неназначенные);
   8. `GET /planning/{plan_id}/requests/{первая заявка}`;
   9. `POST /planning/{plan_id}/apply`;
   10. `GET /calendar?from&to` (текущий месяц);
   11. `GET /days/<та же дата>?region_id=east`;
   12. `POST /events/apply` (`urgent_order_added`, `apply: false`) → `GET /planning/{new}/diff?against=` → `POST /planning/{new}/reject`;
   13. `GET /events?scenario_id`;
   14. `POST /planning/{plan_id}/reassign/check` (первая заявка → другой инженер);
   15. под инженером: `GET /engineers/me/day`, `GET /engineers/me/route?remaining=true`;
   16. под оператором: `GET /booking/slots` (та же дата, Восток), `GET /booking/requests?q=Москва`;
   17. синтетический сценарий ⏳ (ручку загрузки уточняем у бэка): `GET /data/scenarios/{id}` → `synthetic-scenario.json`, `POST /planning/run` → `synthetic-plan.json`. По снимку проверить, что пришло в `source`, `latitude/longitude`, `name`, `type_bk`, `address` (§6.8).
3. `npm run gen:types` — `src/api/schema.d.ts`.
4. По снимкам уточнить `api/types.ts` и форматы в §6.2, §6.3, §6.4, §6.5, §6.6, §6.7, §9. Расхождения с этим ТЗ — в `docs/API_NOTES.md`.

---

## 13. Порядок работ
Этапы после каркаса (этап 01) — §17.1.

| # | Когда | Что | P | Готово, когда |
|---|---|---|---|---|
| 0 | 27.09 вечер | Шаг 0 (§12), каркас Vite, `tokens.css`, `ui/*`, клиент API и ошибки, авторизация, роутинг, моки из снимков | P0 | вход под тремя ролями ведёт на свой экран |
| 1 | 27.09 вечер | DS-01 календарь (статусы, подсказка, фильтры); DS-02 импорт (2 шага, ошибки) | P0 | шаг 1 демо |
| 2 | 28.09 утро | DS-03: `DayModel`, шапка и кнопки по состоянию, «Построить план» = run + apply, состояние до плана, карта, таймлайн, «Сравнение» (+ baseline), «Неназначенные», «сейчас» из часов дня | P0 | шаги 2, 3, 7 демо |
| 3 | 28.09 день | DS-04 (объяснение §6.2), DS-06 (3 вкладки), DS-07 + баннер предложения, «Лента» | P0 | шаги 4–6 демо |
| 4 | 28.09 день | Инженер: E-03 во всех статусах (панель статуса, «Прервать», ждущая заявка в списке — Р-1), E-06, E-09 — §17.1, §17.2 ENG-1…ENG-5 | P0 | 30–40 с инженера в видео |
| 5 | 28.09 до 16:00 | Прогон 7 шагов на стенде без моков; багфикс | P0 | без ошибок в консоли |
| 6 | 28.09 до 18:00 | DS-05, DS-08, DS-09 (меню ⋯), DS-10, «Версии»; E-01, E-02, E-03.1 / E-05, E-04 + Яндекс, E-07 (если есть `incident`), E-08, E-10, меню ⋯ и «Завершить смену»; ENG-6…ENG-10; оператор — §17.3 | P1 | — |
| 7 | 28.09 вечер | Фриз, запись видео: часы дня ставим через Swagger (§7) | P0 | — |

---

## 14. Приёмка — 7 шагов ТЗ §4 на Востоке
1. Вход диспетчером → календарь → «Загрузить CSV» (Восток + контрольный файл) → отчёт импорта → «Открыть день»: точки заявок, «плана нет», FIFO и диспетчер в сравнении.
2. «Построить план» → через ≤ 10 с план опубликован: маршруты бригад на карте, «Версия 1 · сейчас …», главная кнопка — «Добавить событие».
3. «Карта / Таймлайн» — кто, куда и во сколько; фильтр по инженеру работает.
4. Клик по заявке → строка объяснения + «Квалификация ✓ / Время ✓ / Ресурс ✓» + «Почему не другие».
5. Часы дня 12:30 с автопрогоном (сид или Swagger) → «Добавить событие» → «Срочная заявка» → «Рассчитать изменения».
6. Предложение: заголовок, счётчики, бригада и прибытие, diff → «Принять» → версия +1, флаги «Изменено».
7. «Сравнение»: наш / FIFO / реальный, по инженерам и суммарно, у диспетчера — «оценка».
8. **Дополнительно:** вход `eng-east-XX` бригады из аварии → баннер «Новая срочная заявка — после текущей» → «Отправиться в путь» → «Прервать» (клиент отказался) → у инженера тост, заявка «Отменяется» в списке, следующая доступна → у диспетчера «требует решения» → «Подтвердить отмену» → у инженера баннер «Отмена №… подтверждена».
9. **По желанию** (15–20 с, Подход 25%): оператор записывает клиента на сегодня в Востоке → у диспетчера в ленте «Заявка №… встроена к …», версия +1 (D-18).

## 15. Чего не делать
- Регистрацию, восстановление пароля, демо-кнопки входа (D-17).
- Мобильное приложение: инженер — адаптивная веб-страница.
- Вебсокеты, SSR.
- Геолокацию, «Задержусь» (`delay`), «Позвонить клиенту», причины занятых окон.
- Модели оборудования у инженера — только из поля бэка, не выдумываем.
- Живой геокодинг с фронта; у оператора — подсказки адреса и карта.
- Оператор: фильтры поиска; проверку статуса заявки перед «Перенести» / «Отменить» — решает бэк (D-34).
- Новые элементы дизайна (дизайн заморожен). Исключение — поповер часов из существующих `ui/*`.
- Жёлтые вторичные кнопки, чистый чёрный текст, белый текст на жёлтом, перерисованный логотип.
- Устаревшее в схеме: `time`, `request_id` в событиях, `urgent_request`, `request_cancelled`, `/events/replan`, DELETE-ручки.
- `POST /planning/baseline` используем только ради `baseline_routes` (§6.3). Если в схеме ручка помечена `deprecated` или не отвечает — у FIFO в строках «Начато в окне» и «Просрочено» ставим «—».

---

## 16. Правила проекта
```md
# Правила проекта — фронтенд планировщика маршрутов

## Источники правды
- docs/spec/FRONTEND_SPEC.md (v2.5) — поведение, ручки, адаптеры, часы дня, все три роли, порядок работ (§13, §17).
- src/api/schema.d.ts (генерируется из https://api.bee-dynasty.ru/openapi.json) + docs/api-examples/*.json — форма ответов API.
- design/ (Dispatcher_Flow.html, Engineer.html, Operator.html — бандлы, читать после npm run design:unpack в design/_unpacked/; dispatcher-shots/) + docs/spec/DESIGN_SPEC.md — вёрстка (заморожена); docs/spec/UI_KIT_tokens.md — стиль, приоритет над макетом.

## Стек и команды
Vite + React 18 + TS strict · react-router 6 · @tanstack/react-query 5 · react-leaflet 4 · date-fns (ru) · lucide-react · CSS Modules · msw 2 · vitest.
- npm run dev — dev-сервер, /api проксируется на https://api.bee-dynasty.ru (VITE_USE_MOCKS=true — на моках)
- npm run gen:types — типы из OpenAPI
- npm run design:unpack — распаковать макеты в design/_unpacked/ (FRONTEND_SPEC §2.1)
- npm run snapshot — снимок живых ответов в docs/api-examples (нужен .env.local; меняет данные стенда — запускать только по явной команде)
- npm run check — tsc --noEmit + eslint; npm test — тесты адаптеров
- npm run build — прод-сборка

## Правила
- Компоненты работают только с моделями из src/adapters, не с сырым API.
- В событиях и переназначении id заявки — order_id. Все события — apply: false.
- «Сейчас» = nowFor(clock дня), часы во фронте не переводим; at у действий инженера не отправлять.
- Инженер: начать можно только текущую заявку (active_request_id, иначе первая planned). Кнопку «Инцидент» (action incident) показываем, только если он есть в схеме.
- Оператор: /days, /planning, /data не вызывать; статус заявки перед «Перенести» / «Отменить» не проверять — решает бэк.
- Всё, что зависит от правок бэка, — через FEATURES в src/config.ts (FRONTEND_SPEC §5.4); новые флаги по умолчанию false. Список правок — docs/spec/BACKEND_FIXES_FINAL_28-09.md.
- Из макетов не переносить демо-данные, зашитые оси и TASK_STATUS дизайн-системы (FRONTEND_SPEC §2.1).
- Ошибки — только через toApiError (три формата бэка).
- UI-тексты по-русски, термины ТЗ дословно; код — по-английски.
- Цвета, отступы, скругления — только CSS-переменные из tokens.css. Одна жёлтая кнопка на экран, белый на жёлтом запрещён.
- Три ограничения подписаны «Квалификация», «Время», «Ресурс». Сравнение — 3 колонки.
- Статусы и флаги — только из src/lib/statuses.ts.
- У заявки и бригады надёжно заполнены только id, окно, длительность, навык, транспорт и смена. Адрес, район, type_bk, имя, координаты могут быть пустыми или условными (синтетика) — подписи только через src/adapters/normalize.ts (FRONTEND_SPEC §6.8). Часы 10:00/22:00 не зашивать.
- Фильтры и открытые панели — в URL. В localStorage — только токен и UI-мелочи. Пароли — только в .env.local.
- Перед коммитом: npm run check и npm test без ошибок.
```

---

## 17. Этапы работ после каркаса
Этап 01 (каркас) сделан. Дальше — этапы A…H по порядку, P0 сначала.
- Один шаг — один коммит; перед коммитом `npm run check` и `npm test`.
- После этапа — короткий отчёт: что сделано, что проверить руками.

### 17.1. Этапы
| Этап | P | Что | Разделы | Готово, когда |
|---|---|---|---|---|
| A | P0 | Фундамент. Файлы спек и макетов на месте, `npm run design:unpack`, правила проекта по §16. `FEATURES` по §5.4, роуты по §4 (оператор — новые пути). Токены из §2.1, `ui/*` по дизайн-системе, AppBar (§8.1). Модули `api/*`, ключи, типы (§5.2, §8.3.4). Моки: фикстуры по типам схемы до снимка + ошибки `ILLEGAL_TRANSITION`, `SLOT_TAKEN`, `COMMENT_REQUIRED`, `STALE_PROPOSAL` | §2.1, §3–§5, §8.1, §10 | вход тремя ролями на моках ведёт на свои экраны; `npm run check`, `npm test` зелёные |
| B | P0 | Диспетчер. DS-01, DS-02 → DS-03 (`DayModel`, шапка по состоянию, карта, таймлайн, «Сравнение», «Неназначенные», часы дня) → DS-04, DS-06, DS-07, баннер предложения, «Лента». Таблица финального макета — §8.2 | §6, §7, §8.2, §13 шаги 1–3 | шаги 1–7 §14 на моках |
| C | P0 | Инженер ENG-1…ENG-5 (§17.2) | §9 | шаг 8 §14 на моках |
| D | P0 | Прогон на стенде без моков — вместе с пользователем. Снимок API (§12) — только по его команде. Сверка адаптеров со снимком, расхождения — в `docs/API_NOTES.md` | §12, §14 | 7 шагов + шаг 8 без ошибок в консоли |
| E | P1 | Диспетчер P1: DS-05, DS-08, DS-09, DS-10, «Версии» | §6.3, §6.7, §8.2 | — |
| F | P1 | Инженер ENG-6…ENG-10 | §9 | — |
| G | P1 | Оператор OP-1…OP-5 (§17.3) | §8.3 | приёмка §8.3.12 |
| H | P0 | Фриз: README (запуск, демо-учётки — «см. гайд бэка», часы дня через Swagger), `npm run build` | §7, §11 | запуск по README с нуля |

### 17.2. Инженер (§9) — этапы C и F
| # | P | Что | Готово, когда |
|---|---|---|---|
| ENG-1 | P0 | `api/engineer.ts`: `/me/day` (опрос 15 с), `/me/route`, `/me/actions` (ответ `day` → кэш `engineerDay`); `lib/engineerLabels.ts`; селектор `currentVisit` | тесты подписей и `currentVisit` зелёные |
| ENG-2 | P0 | `EngineerApp`: шапка 56 px, `EngineerMenu`, таблица состояний страницы (§9.1) | все состояния видны на моках |
| ENG-3 | P0 | E-03: `ActiveVisitCard` + `StatusPanel` (`en_route` → `start` → `complete`), `DoneToast`, «Далее по маршруту» с `WaitingRow`, `CompletedBlock` | цепочка статусов на моке; 409 откатывает статус |
| ENG-4 | P0 | E-06 `InterruptSheet` → `fail`; строка «Другое» — по `failOther` | заявка уходит в «Далее» с «Отменяется», текущей стала следующая |
| ENG-5 | P0 | E-09 `PlanChangedBanner` из `banners[]`, ключ `seen_banner_<at>_<type>` | приёмка §14 п. 8 |
| ENG-6 | P1 | E-01 `PreviewScreen`, E-02 `TransportSheet` → `shift_start` | — |
| ENG-7 | P1 | E-03.1 / E-05 `VisitCardPage`, снятие «Изменено» | — |
| ENG-8 | P1 | E-04 `EngineerMap` + `lib/yandexMaps.ts` | ссылки открывают Яндекс Карты на телефоне |
| ENG-9 | P1 | E-08 `UnavailableSheet` («Не выйду сегодня» — по `unavailableBeforeShift`); E-07 `IncidentSheet` — по `engineerIncident` | — |
| ENG-10 | P1 | «Завершить смену» + `ShiftEndConfirm`, E-10 `ShiftSummary` | — |

### 17.3. Оператор (§8.3) — этап G · P1
| # | Что | Готово, когда |
|---|---|---|
| OP-1 | `lib/booking.ts`, `api/booking.ts`, `adapters/booking.ts`, `OperatorLayout`, `operatorTexts.ts` | юнит-тесты §8.3.12 зелёные |
| OP-2 | O-02: поиск, карточка, отмена | приёмка §8.3.12, п. 1, 4, 6, 7 |
| OP-3 | O-01 + O-01.2: форма, строка навыка, окна, запись, `SLOT_TAKEN` | п. 2, 3, 8 |
| OP-4 | O-02.1 перенос | п. 5 |
| OP-5 | Вкладка «Авария» — только при `emergencyByRegion` | авария приходит диспетчеру предложением |
