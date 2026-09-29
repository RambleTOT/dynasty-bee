# src/api — транспорт и контракты API

- `client.ts` — `request()` и `api.get / post / patch / postForm`. Единственное место с `fetch`. Bearer-токен, 204 → `undefined`, 401 с токеном → событие `auth:unauthorized`, сеть → `ApiError(0, 'NETWORK')`.
- `errors.ts` — `ApiError`, `toApiError` (три формата ошибок бэка), `errorMessage`.
- `queryClient.ts` — настройки react-query: без повторов на 4xx, до 2 повторов на сеть и 5xx, без опроса в фоне.
- `queryKeys.ts` — ключи запросов (префиксы для инвалидации — FRONTEND_SPEC §5.3).
- `schema.d.ts` — **генерируется** `npm run gen:types`, руками не править.
- `types.ts` — алиасы на `components['schemas']` + ручные типы для ответов без схемы.
- `auth.ts` — `/auth/login`, `/auth/me`, `/auth/logout`.

## Будущие модули ручек (FRONTEND_SPEC §5.3)

| Модуль             | Ручки                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar.ts`      | `GET /calendar`                                                                                                                                       |
| `days.ts`          | `GET /days/{date}`                                                                                                                                    |
| `data.ts`          | `/data/import-beeline`, `/data/scenarios/{id}`, ростер `/data/scenarios/{id}/engineers`, `/regions`                                                   |
| `planning.ts`      | `/planning/run`, `/planning/{id}`, `apply`, `reject`, `diff`, `compare`, `baseline`, `reassign/check`, `reassign`, `extend-resource`, `GET /planning` |
| `events.ts`        | `POST /events/apply` (`apply: false`), `GET /events`                                                                                                  |
| `booking.ts`       | `/booking/slots`, `/booking/requests`, `cancel`, `reschedule`                                                                                         |
| `engineer.ts`      | `/engineers/me/day`, `/engineers/me/route`, `/engineers/me/actions`                                                                                   |
| `visualization.ts` | `GET /visualization/{plan_id}/geojson`                                                                                                                |
| `clock.ts`         | `/data/scenarios/{id}/clock` ⏳ (в схеме пока нет — BACKEND_FIXES §1)                                                                                 |

Правила: id заявки в событиях и переназначении — `order_id`; все события — `apply: false`; `at` у действий инженера не шлём; DELETE-ручки не используем.
