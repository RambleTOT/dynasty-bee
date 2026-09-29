/** База API. В dev `/api` проксирует Vite (vite.config.ts), в проде — адрес бэка из VITE_API_URL. */
export const API_URL: string = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '');

/** Моки MSW вместо бэка (src/mocks). */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

/** Интервалы опроса, мс (FRONTEND_SPEC §5.1). В фоновой вкладке опрос выключен — см. queryClient. */
export const POLL = { day: 10_000, engineer: 15_000, calendar: 30_000, slots: 30_000 } as const;

/**
 * Живые обновления по WebSocket (docs/REALTIME.md, контракт — docs/BACKEND_REQUESTS.md п. 38).
 * Пока сокет открыт, опрос — страховка на случай потерянного события.
 */
export const REALTIME = {
  /**
   * Опрос при открытом сокете. С 29.09 (9dc3a17) бэк шлёт почти все виды событий, кроме
   * booking.cancelled / booking.rescheduled, roster.changed и plan.built / plan.published (п. 38):
   * опрос не реже обычного. Когда пришлёт всё — 60 с.
   */
  safetyPollMs: 10_000,
  /** Сервер шлёт `ping` раз в 25 с; тишина дольше — соединение мёртвое, переподключаемся. */
  heartbeatTimeoutMs: 60_000,
  /** Паузы перед переподключением, дальше — последняя; ±20 % случайно, чтобы вкладки не шли разом. */
  backoffMs: [1_000, 2_000, 5_000, 10_000, 30_000],
  /** События за это время — одним обновлением запросов. */
  batchMs: 250,
} as const;

/** Часовой пояс всех «сейчас» и дат (FRONTEND_SPEC §7). */
export const TZ = 'Europe/Moscow';

/**
 * Подсказки адресов при вводе и адрес точки на карте — Photon (OpenStreetMap, без ключа): геокодер
 * Яндекса по нашему ключу не отвечает (403). Своя копия Photon — `VITE_ADDRESS_SUGGEST_URL`,
 * выключить — `off`. В сервис уходит только набранный адрес.
 */
const SUGGEST_URL = (import.meta.env.VITE_ADDRESS_SUGGEST_URL ?? '').trim();
export const ADDRESS_SUGGEST = {
  url: SUGGEST_URL === 'off' ? null : (SUGGEST_URL || 'https://photon.komoot.io').replace(/\/+$/, ''),
  /** Центр Москвы: подсказки ближе к нему — выше. */
  center: { lat: 55.7558, lon: 37.6173 },
  /** Москва и область: lon1,lat1,lon2,lat2. */
  bbox: '35.14,54.25,40.21,56.96',
  minChars: 3,
  debounceMs: 350,
  limit: 7,
} as const;

/**
 * Правки бэка (docs/spec/BACKEND_FIXES_FINAL_28-09.md), без которых кнопка или запрос упадут.
 * Меняем руками после ответа бэка или проверки Swagger; один флаг на правку (FRONTEND_SPEC §5.4).
 */
const FEATURE_DEFAULTS = {
  dayClock: true, // §1  ручки /data/scenarios/{id}/clock, clock в /days и /me/day — есть с 28.09
  failOther: true, // 8.3 fail.reason 'other' + comment — есть с 28.09 (COMMENT_REQUIRED)
  engineerIncident: true, // 8.4 action 'incident' — есть с 28.09 (09:48)
  unavailableBeforeShift: true, // 8.5 unavailable при shift_status = not_started — проверено 28.09
  emergencyByRegion: true, // 9.1 авария оператора по params.region_id — есть с 28.09
  cancelComment: true, // 9.3 comment в отмене оператора — есть с 28.09
  // правки по docs/BACKEND_REQUESTS.md — на стенде с 28.09 19:07 (гайд бэка §9, §10)
  addEngineerAfterPublish: true, // §12, P1-6 бригада в начатый день — событие engineer_added → предложение
  extendResourceCheck: true, // P1-5 «кого не хватает» — extend-resource/check, без сохранения предложения
  comparePlanStrategy: true, // P1-8 «Наш план» в сравнении — стратегия plan тем же расчётом, что FIFO
  // п. 38: WebSocket живых обновлений (/realtime/ticket, /realtime/ws) — есть с 29.09 (85cbf26),
  // с 9dc3a17 — перезапуск сервера (resumed: false) и почти все виды событий
  realtime: true,
  // п. 47: поле time («сейчас» дня) в reassign/check и reassign — есть с 29.09 (85cbf26)
  reassignTime: true,
  // §14 (docs/spec/BACKEND_ANY_REGION.md): свои участки — POST/PATCH /regions, ростер участка,
  // колонки «Навык», «Длительность», «Широта», «Долгота» в import-beeline — есть с 29.09 (85cbf26).
  // Включать руками не нужно: фронт включает сам, когда в GET /regions есть поле builtin
  // (lib/regions.ts `anyRegionEnabled`)
  anyRegion: false,
  // п. 55: правило D-06 без гигабита (D-40) — автомобиль нужен кабелю и аварии, гигабит остаётся
  // признаком заявки; у бэка — с 29.09 (9dc3a17). Отчёт импорта берёт правило из ответа бэка сам
  // (required_transport.rule), флаг — для формы оператора и подсказок мастера участка
  transportRuleNoGigabit: true,
};

export type FeatureFlag = keyof typeof FEATURE_DEFAULTS;

/** Включить флаги без правки кода (проверка на моках): VITE_FEATURES=failOther,engineerIncident */
function enabledFromEnv(raw: string | undefined): Partial<Record<FeatureFlag, boolean>> {
  const names = (raw ?? '').split(',').map((name) => name.trim());
  return Object.fromEntries(
    names.filter((name) => name in FEATURE_DEFAULTS).map((name) => [name, true]),
  );
}

export const FEATURES: Readonly<Record<FeatureFlag, boolean>> = {
  ...FEATURE_DEFAULTS,
  ...enabledFromEnv(import.meta.env.VITE_FEATURES),
};
