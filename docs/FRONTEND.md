# Фронтенд

Одностраничное приложение на React 18 + TypeScript, сборка — Vite 5. Лежит в папке `frontend/`. Одно приложение на три роли: диспетчер (`/dispatcher`, десктоп), оператор (`/operator`, десктоп) и инженер (`/engineer`, телефон). Роль приходит с бэкенда после входа.

Планирование, перепланирование и метрики считает бэкенд. Фронтенд показывает результат и отправляет действия пользователя. Как запустить — README, раздел «Запуск».

**Библиотеки** (`frontend/package.json`): react-router-dom 6 — маршруты, @tanstack/react-query 5 — запросы и кэш, leaflet + react-leaflet — карта OpenStreetMap, date-fns — даты, lucide-react — иконки. Стили — CSS Modules на токенах `src/styles/tokens.css`. Тесты — vitest + Testing Library, моки API — msw.

## Папки

```
frontend/
  index.html, vite.config.ts   точка входа страницы; dev-порт 5173 и прокси /api
  .env.example                 шаблон переменных окружения
  src/
    main.tsx                   запуск: стили, моки MSW (если VITE_USE_MOCKS=true), <App/>
    config.ts                  база API, интервалы опроса, флаги FEATURES, настройки подсказок адресов
    app/                       App, провайдеры, router.tsx (маршруты и роли), RequireRole, лейауты, шапка
    api/                       HTTP-клиент, ошибки, модули ручек по разделам бэкенда, ключи кэша, типы
    adapters/                  ответы API → модели экранов: день, версии, сравнение, отчёт импорта, CSV
    auth/                      токен (localStorage `auth_token`), AuthProvider, роли
    features/                  экраны: auth (вход), dispatcher, operator, engineer, shared (адрес, карта)
    realtime/                  WebSocket живых обновлений
    lib/                       статусы, справочники, время (Europe/Moscow), разбор CSV, карта, тексты
    ui/                        UI-кит: кнопки, модалки, поля, чипы
    hooks/, pages/, styles/, mocks/, test/
  public/                      иконки, воркер MSW
  scripts/                     deploy.sh, deploy-nginx.sh, snapshot-api.mjs, unpack-design.mjs
  deploy/                      конфиги nginx сайта, скрипты сервера
  docs/                        ARCHITECTURE, API_NOTES, REALTIME, SECURITY, BACKEND_REQUESTS, spec/ — ТЗ и макеты
```

Правило слоёв (`frontend/docs/ARCHITECTURE.md`): экраны не вызывают `fetch` и не читают сырые ответы — только модели из `adapters/`. `fetch` есть только в `src/api/client.ts`.

## Ключевые компоненты

| Что | Где (`frontend/src/`) | Роль |
|---|---|---|
| Маршруты | `app/router.tsx` | `/` → главная роли или `/login`; `/dispatcher`, `/dispatcher/day/:date`; `/operator`, `/operator/new`, `/operator/reschedule/:id`; `/engineer`, `/engineer/request/:id`. `RequireRole` пускает только свою роль |
| Сессия | `auth/AuthProvider.tsx` | токен и `GET /auth/me`; ответ 401 на запрос с токеном — выход на `/login` |
| Календарь | `features/dispatcher/calendar/CalendarPage.tsx` | заявки по дням месяца, фильтры по участку, статусу и типу |
| Загрузка CSV | `features/dispatcher/import/ImportModal.tsx` | окно «Загрузка CSV» и отчёт импорта (ниже) |
| День диспетчера | `features/dispatcher/day/DayPage.tsx` | карта (`YandexDayMap` или `LeafletDayMap`), таймлайн, сравнение с FIFO и реальным диспетчером, неназначенные, лента, версии. Данные — `useDayData.ts` |
| Действия дня | `features/dispatcher/day/useDayActions.ts`, `EventModal.tsx`, `ProposalDrawer.tsx`, `ReassignModal.tsx`, `RosterDrawer.tsx` | «Построить план»; события — срочная, отмена, недоступность, смена транспорта, новая бригада — дают предложение, его принимают или отклоняют; ручное переназначение; состав бригад |
| Оператор | `features/operator/` | поиск заявки, отмена и перенос, запись клиента в свободное окно, авария |
| Инженер | `features/engineer/EngineerApp.tsx` | маршрут на день, нажатия «В пути», «Начать», «Выполнена», прерывание, карта |
| Живые обновления | `realtime/RealtimeProvider.tsx` | сокет: события бэкенда → обновление экранов и уведомления. Пока сокет открыт, опрос остаётся страховкой |

Модальные окна открываются параметрами адреса, а не отдельными маршрутами: `modal=import`, `request=<id>`, `proposal=<plan_id>` и т. д. Схема — `features/dispatcher/day/daySearch.ts`.

## Вызовы бэкенда

**Базовый URL.** `API_URL = VITE_API_URL || '/api/v1'` (`src/config.ts`). Адрес запроса собирает `buildUrl` в `src/api/client.ts`: `API_URL + путь + query`. По умолчанию путь относительный, то есть запросы идут на тот же хост, что и страница:

- в dev их проксирует Vite на `DEV_API_TARGET` или на стенд `https://api.bee-dynasty.ru` (`vite.config.ts`, WebSocket тоже);
- на сервере — nginx сайта: `location /api/` → апстрим `beeline_api` (`deploy/nginx/bee-dynasty.conf`).

Токен уходит заголовком `Authorization: Bearer …`. Ошибки бэкенда трёх форматов сводит `toApiError` (`src/api/errors.ts`). Метода DELETE в клиенте нет.

| Раздел | Ручки | Модуль `src/api/` |
|---|---|---|
| Вход | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | `auth.ts` |
| Участки | `GET /regions`, `POST /regions`, `PATCH /regions/{id}`, `GET` и `PUT /regions/{id}/roster` | `data.ts`, `regions.ts` |
| Данные дня | `POST /data/import-beeline`, `GET /data/scenarios/{id}`, `GET` и `POST /data/scenarios/{id}/engineers`, `PATCH /data/scenarios/{id}/engineers/{engineer_id}`, `GET /data/scenarios/{id}/clock` | `data.ts`, `clock.ts` |
| Календарь и день | `GET /calendar`, `GET /days/{date}` | `calendar.ts`, `days.ts` |
| План | `POST /planning/run`, `GET /planning`, `GET /planning/{id}`, `POST /planning/{id}/apply`, `POST /planning/{id}/reject`, `GET /planning/{id}/diff`, `GET /planning/{id}/requests/{request_id}`, `POST /planning/compare`, `POST /planning/baseline`, `POST /planning/{id}/reassign/check`, `POST /planning/{id}/reassign`, `POST /planning/{id}/extend-resource/check`, `POST /planning/{id}/extend-resource` | `planning.ts` |
| События | `POST /events/apply` (всегда `apply: false`), `GET /events` | `events.ts`, `booking.ts` |
| Оператор | `GET /booking/requests`, `GET /booking/slots`, `POST /booking/requests`, `POST /booking/requests/{id}/cancel`, `POST /booking/requests/{id}/reschedule` | `booking.ts` |
| Инженер | `GET /engineers/me/day`, `GET /engineers/me/route`, `POST /engineers/me/actions` | `engineer.ts` |
| Карта | `GET /visualization/{plan_id}/geojson` | `visualization.ts` |
| Живые обновления | `POST /realtime/ticket`, WebSocket `/realtime/ws?ticket=…&since=…` | `realtime.ts` |

Типы ответов генерируются из схемы бэкенда: `npm run gen:types` → `src/api/schema.d.ts`.

**Внешние сервисы, не бэкенд:**
- подсказки адресов и поиск точек — Photon (`https://photon.komoot.io` или `VITE_ADDRESS_SUGGEST_URL`), `src/api/geocoder.ts`;
- JavaScript API Яндекс Карт 2.1 — только если задан `VITE_YANDEX_MAPS_KEY`;
- тайлы OpenStreetMap для Leaflet (`src/lib/map.ts`);
- шрифт Onest с Google Fonts (`src/styles/tokens.css`).

## Загрузка CSV

Кнопка «Загрузить CSV» в шапке диспетчера открывает окно (`?modal=import`).

1. **Дата плана** — по умолчанию сегодня по Москве; прошедшие даты не принимаются (`import/importDate.ts`).
2. **Файлы.** У каждого участка кейса — Восток, Юго-восток, Югоцентр — «Файл заявок (.csv)» (обязателен) и «Контрольное распределение» (по желанию). Фронтенд только считает строки для подписи (`lib/csv.ts`: UTF-8 или Windows-1251). Разбирает файл бэкенд.
3. **Проверка дня** — `GET /days/{date}?region_id=…` по каждому участку:
   - на дату уже загружен CSV — предупреждение и подтверждение «Заменить и загрузить», прежний день бэкенд отправит в архив;
   - есть записи оператора — участок заблокирован, бэкенд ответил бы `409 DATE_HAS_BOOKINGS`.
4. **«Загрузить»** — участки по очереди: `POST /data/import-beeline`, multipart с полями `requests_file`, `control_file` (если выбран), `region_id`, `date`. В ответе — сводка дня с `import_report`.
5. **Отчёт импорта** — карточка на участок (`adapters/importReport.ts`): сколько заявок загружено, офис, скольким нужен автомобиль и по какому правилу, назначения реального диспетчера (если был контрольный файл), пропущенные строки, адреса без координат, предупреждения. Бейдж — «Готово», «Есть замечания» или «Ошибка». «Открыть день» ведёт на `/dispatcher/day/{date}?region=…`.
6. **«Построить план»** на экране дня: `POST /planning/run` (`seed: 42`, `include_baseline: true`) и сразу `POST /planning/{id}/apply` — план публикуется инженерам.

**«Другой участок».** Карточка появляется, если `GET /regions` отдаёт поле `builtin` (или включён флаг `anyRegion`). Мастер `import/region/RegionWizard.tsx` ведёт через пять шагов:

1. участок и файлы — название, офис с точкой, файл заявок; контрольный файл и файл бригад — по желанию;
2. колонки — любой CSV: UTF-8 или Windows-1251, разделитель `;`, `,` или табуляция; колонки сопоставляются с полями заявки;
3. нормативы — тип заявки → навык и минуты;
4. бригады — из контрольного файла, файла бригад, сохранённого состава или по правилу;
5. точки заявок — координаты из файла, остальные ищутся в Photon по кнопке.

«Загрузить» создаёт участок (`POST /regions`) или обновляет его (`PATCH /regions/{id}`), сохраняет состав (`PUT /regions/{id}/roster`) и отправляет файл, приведённый к формату Билайна, в тот же `POST /data/import-beeline` вместе с `engineers_file`. Дальше — тот же отчёт.

## Требует уточнения

1. **CSV для проверки.** Файлы кейса в репозиторий не входят (`frontend/.gitignore`: `samples/`). Проверяющий берёт их из материалов кейса. Если файлы нужны в репозитории — решение команды.
2. **Пароль демо-учёток.** Логины перечислены в README, пароль в репозитории не публикуется. Где его получить проверяющему — не указано.
3. **Бэкенд.** В этом репозитории бэкенда нет. Адрес стенда `https://api.bee-dynasty.ru` зашит в `vite.config.ts` (прокси) и в `npm run gen:types`. Ссылка на репозиторий бэкенда не заполнена.
4. **Версии Node и npm.** `.nvmrc` и `engines` — Node 20, но для `npm run check` нужна 20.19+. Версия npm в конфигах не зафиксирована (`frontend/README.md` пишет «npm 10+»).
5. **`DEV_API_TARGET`** читается из окружения процесса (`process.env` в `vite.config.ts`). Из `.env.local` Vite её не подхватывает, а `frontend/README.md` перечисляет её среди переменных `.env.local`.
6. **Порт `npm run preview`** в конфиге не задан.
7. **`npm run design:unpack`** требует папку `frontend/design/`, а корневой `.gitignore` её исключает.
8. **`npm run deploy` и `scripts/deploy-nginx.sh`** выкладывают на сервер команды по SSH-ключу — для стороннего запуска не нужны.
9. **`frontend/docs/api-examples/`** пуста (`.gitkeep`), хотя `frontend/docs/ARCHITECTURE.md` ссылается на снимки ответов оттуда. Тесты адаптеров берут фикстуры из `src/adapters/__fixtures__/`.
10. **Моки MSW** (`VITE_USE_MOCKS=true`) закрывают только вход. Без бэкенда остальные экраны не работают.
