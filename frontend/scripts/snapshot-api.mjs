#!/usr/bin/env node
/**
 * Снимок живых ответов API → docs/api-examples/<NN>_<name>.json (FRONTEND_SPEC §12).
 *
 * Запуск: `npm run snapshot` — ТОЛЬКО по команде пользователя.
 * Нужен .env.local (см. .env.example): API_URL, DEMO_DISPATCHER, DEMO_OPERATOR, DEMO_ENGINEER, DEMO_PASSWORD.
 *
 * Что меняет на стенде: тестовый день «сегодня + 30 дней», регион Восток — load-demo, построение
 * и публикация плана, одно событие (его предложение сразу отклоняется). Сегодняшний демо-день
 * не трогает, DELETE не вызывает. Токены и пароли в файлы не пишет.
 * Шаг упал — в файл пишется {error, status, body}, скрипт идёт дальше; в конце — сводка.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'api-examples');

dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true });

const API_URL = (process.env.API_URL || 'https://api.bee-dynasty.ru/api/v1').replace(/\/+$/, '');
const LOGINS = {
  dispatcher: process.env.DEMO_DISPATCHER || 'dispatcher',
  operator: process.env.DEMO_OPERATOR || 'operator',
  engineer: process.env.DEMO_ENGINEER || 'eng-east-01',
};
const PASSWORD = process.env.DEMO_PASSWORD;
const REGION = 'east';
const TZ = 'Europe/Moscow';

if (!PASSWORD) {
  console.error(
    'Нет DEMO_PASSWORD: создайте .env.local из .env.example и впишите пароль демо-учёток.',
  );
  process.exit(1);
}

// ---------- даты (Москва) ----------

const ymdMsk = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthRange(ymd) {
  const [year, month] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = ymd.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, '0')}` };
}

const TODAY = ymdMsk(new Date());
const TEST_DATE = addDays(TODAY, 30);

// ---------- HTTP ----------

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function call(method, urlPath, { token, query, json } = {}) {
  const url = new URL(urlPath.startsWith('http') ? urlPath : API_URL + urlPath);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw new HttpError(response.status, body);
  return body;
}

// ---------- запись файлов ----------

const secrets = new Set([PASSWORD]);
const isSecretKey = (key) => /password|secret|authorization/i.test(key) || /(^|_)token$/i.test(key);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSecretKey(key) ? '<redacted>' : redact(item),
      ]),
    );
  }
  return value;
}

async function save(file, data) {
  let text = `${JSON.stringify(redact(data), null, 2)}\n`;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) text = text.split(secret).join('<redacted>');
  }
  await writeFile(path.join(OUT_DIR, file), text, 'utf8');
}

const results = [];

/** Шаг снимка: ответ → файл; ошибка → {error, status, body} в тот же файл, идём дальше. */
async function step(file, label, fn) {
  try {
    const data = await fn();
    await save(file, data);
    results.push({ file, label, state: 'ok' });
    return data ?? null;
  } catch (error) {
    const payload =
      error instanceof HttpError
        ? { error: error.message, status: error.status, body: error.body }
        : { error: String(error?.message ?? error), status: null, body: null };
    await save(file, payload);
    results.push({
      file,
      label,
      state: 'failed',
      note: payload.status ? `HTTP ${payload.status}` : payload.error,
    });
    return undefined;
  }
}

/** Пропуск шага: в файл — причина, в сводку — пометка. */
async function skip(file, label, reason) {
  await save(file, { skipped: reason });
  results.push({ file, label, state: 'skipped', note: reason });
}

async function login(role, file) {
  const data = await step(file, `POST /auth/login (${LOGINS[role]})`, () =>
    call('POST', '/auth/login', { json: { login: LOGINS[role], password: PASSWORD } }),
  );
  const token = data?.access_token;
  if (token) secrets.add(token);
  return token;
}

// ---------- помощники по данным ----------

const maxTime = (times) => times.filter(Boolean).sort().at(-1);

function firstAssigned(plan) {
  for (const route of plan?.routes ?? []) {
    const point = route.route?.[0];
    if (point?.request_id) return { requestId: point.request_id, engineerId: route.engineer_id };
  }
  return undefined;
}

function isSyntheticScenario(scenario) {
  if (scenario?.scenario_metadata?.synthetic === true) return true;
  if (/synth|instance|bench/i.test(scenario?.source ?? '')) return true;
  return /^T\d{3}$/.test(scenario?.requests?.[0]?.id ?? '');
}

// ---------- сценарий снимка ----------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Снимок API ${API_URL}`);
  console.log(`Тестовый день: ${TEST_DATE} (сегодня ${TODAY} + 30), регион ${REGION}\n`);

  const dispatcher = await login('dispatcher', '00_auth-login.json');
  if (dispatcher)
    await step('00_auth-me.json', 'GET /auth/me', () =>
      call('GET', '/auth/me', { token: dispatcher }),
    );

  const asDispatcher = (method, urlPath, options = {}) =>
    call(method, urlPath, { ...options, token: dispatcher });

  // 1. Регионы
  await step('01_regions.json', 'GET /regions', () => asDispatcher('GET', '/regions'));

  // 2. Тестовый день
  const loaded = await step(
    '02_load-demo.json',
    `POST /data/load-demo (${REGION}, ${TEST_DATE})`,
    () =>
      asDispatcher('POST', '/data/load-demo', { query: { region_id: REGION, date: TEST_DATE } }),
  );
  const scenarioId = loaded?.scenario_id;

  // 3. Сценарий и сравнение до плана
  let scenario;
  if (scenarioId) {
    scenario = await step('03_scenario.json', 'GET /data/scenarios/{id}', () =>
      asDispatcher('GET', `/data/scenarios/${scenarioId}`),
    );
    await step('03_compare-before-plan.json', 'POST /planning/compare (до плана)', () =>
      asDispatcher('POST', '/planning/compare', {
        json: { scenario_id: scenarioId, strategies: ['fifo', 'dispatcher'] },
      }),
    );
  } else {
    await skip('03_scenario.json', 'GET /data/scenarios/{id}', 'нет scenario_id: шаг 2 не прошёл');
  }

  // 4–5. План
  let planId;
  let plan;
  if (scenarioId) {
    const run = await step('04_planning-run.json', 'POST /planning/run', () =>
      asDispatcher('POST', '/planning/run', {
        json: { scenario_id: scenarioId, seed: 42, include_baseline: true },
      }),
    );
    planId = run?.plan_id;
  }
  if (planId) {
    plan = await step('05_plan.json', 'GET /planning/{id}', () =>
      asDispatcher('GET', `/planning/${planId}`),
    );
  } else {
    await skip('05_plan.json', 'GET /planning/{id}', 'нет plan_id: шаг 4 не прошёл');
  }

  if (planId) {
    // 6. Карта
    await step('06_geojson-road.json', 'GET /visualization/{id}/geojson?geometry=road', () =>
      asDispatcher('GET', `/visualization/${planId}/geojson`, { query: { geometry: 'road' } }),
    );

    // 7. Сравнение, FIFO, версии, ресурсы
    await step('07_compare.json', 'POST /planning/compare', () =>
      asDispatcher('POST', '/planning/compare', {
        json: { plan_id: planId, strategies: ['ours', 'fifo', 'dispatcher'] },
      }),
    );
    await step('07_baseline.json', 'POST /planning/baseline', () =>
      asDispatcher('POST', '/planning/baseline', { json: { plan_id: planId } }),
    );
    await step('07_plans.json', 'GET /planning?scenario_id', () =>
      asDispatcher('GET', '/planning', { query: { scenario_id: scenarioId } }),
    );
    const unassigned = (plan?.unassigned ?? []).map((item) => item.request_id).filter(Boolean);
    if (unassigned.length) {
      // apply: false — только расчёт, план не меняем (в схеме поле обязательное).
      await step('07_extend-resource.json', 'POST /planning/{id}/extend-resource', () =>
        asDispatcher('POST', `/planning/${planId}/extend-resource`, {
          json: { order_ids: unassigned, option: 'add_engineer', apply: false },
        }),
      );
    } else {
      await skip(
        '07_extend-resource.json',
        'POST /planning/{id}/extend-resource',
        'в плане нет неназначенных заявок',
      );
    }

    // 8. Карточка заявки
    const target = firstAssigned(plan) ?? { requestId: scenario?.requests?.[0]?.id };
    if (target.requestId) {
      await step('08_plan-request.json', 'GET /planning/{id}/requests/{rid}', () =>
        asDispatcher('GET', `/planning/${planId}/requests/${encodeURIComponent(target.requestId)}`),
      );
    } else {
      await skip('08_plan-request.json', 'GET /planning/{id}/requests/{rid}', 'в плане нет заявок');
    }
  }

  // 9. Публикация
  let activePlanId;
  if (planId) {
    const applied = await step('09_plan-apply.json', 'POST /planning/{id}/apply', () =>
      asDispatcher('POST', `/planning/${planId}/apply`),
    );
    if (applied) activePlanId = applied.active_plan_id ?? applied.plan_id ?? planId;
  } else {
    await skip('09_plan-apply.json', 'POST /planning/{id}/apply', 'нет plan_id: шаг 4 не прошёл');
  }

  // 10–11. Календарь (текущий месяц) и день
  const month = monthRange(TODAY);
  await step('10_calendar.json', `GET /calendar (${month.from}…${month.to})`, () =>
    asDispatcher('GET', '/calendar', { query: month }),
  );
  await step('11_day.json', `GET /days/${TEST_DATE}?region_id=${REGION}`, () =>
    asDispatcher('GET', `/days/${TEST_DATE}`, { query: { region_id: REGION } }),
  );

  // 12. Событие → предложение → diff → отклонить
  if (activePlanId) {
    const source = scenario?.requests?.[0];
    const shiftEnd =
      maxTime((scenario?.engineers ?? []).map((engineer) => engineer.shift_end)) ??
      maxTime((plan?.routes ?? []).map((route) => route.shift_end));
    if (!shiftEnd) {
      await skip(
        '12_event-urgent.json',
        'POST /events/apply',
        'нет смен бригад: не из чего взять window_end',
      );
    } else {
      const event = await step(
        '12_event-urgent.json',
        'POST /events/apply (urgent_order_added)',
        () =>
          asDispatcher('POST', '/events/apply', {
            json: {
              type: 'urgent_order_added',
              plan_id: activePlanId,
              source: 'dispatcher',
              apply: false,
              event_time: '12:30',
              request: {
                id: 'U-SNAP',
                address: source?.address ?? undefined,
                latitude: source?.latitude ?? undefined,
                longitude: source?.longitude ?? undefined,
                duration_minutes: 80,
                window_start: '12:30',
                window_end: shiftEnd,
                priority: 'urgent',
                required_skill: 'emergency',
                required_transport: 'car',
                type_bk: 'Глобальная проблема',
                type_hd: 'Авария',
                source: 'dispatcher',
              },
            },
          }),
      );
      const proposedId = event?.plan?.plan_id;
      const previousId = event?.previous_plan_id ?? activePlanId;
      if (proposedId) {
        await step('12_diff.json', 'GET /planning/{new}/diff?against=', () =>
          asDispatcher('GET', `/planning/${proposedId}/diff`, { query: { against: previousId } }),
        );
        if (event.status === 'applied') {
          await skip(
            '12_reject.json',
            'POST /planning/{new}/reject',
            'событие применено сразу — отклонять нечего',
          );
        } else {
          await step('12_reject.json', 'POST /planning/{new}/reject', () =>
            asDispatcher('POST', `/planning/${proposedId}/reject`),
          );
        }
      }
    }
  } else {
    await skip(
      '12_event-urgent.json',
      'POST /events/apply',
      'нет опубликованного плана: шаг 9 не прошёл',
    );
  }

  // 13. Лента
  if (scenarioId) {
    await step('13_events.json', 'GET /events?scenario_id', () =>
      asDispatcher('GET', '/events', { query: { scenario_id: scenarioId, limit: 50 } }),
    );
  }

  // 14. Проверка переназначения: первая заявка → другой инженер
  const first = firstAssigned(plan);
  const otherEngineer = [
    ...(plan?.routes ?? []).map((route) => route.engineer_id),
    ...(scenario?.engineers ?? []).map((e) => e.id),
  ].find((id) => id && id !== first?.engineerId);
  if (activePlanId && first && otherEngineer) {
    await step('14_reassign-check.json', 'POST /planning/{id}/reassign/check', () =>
      asDispatcher('POST', `/planning/${activePlanId}/reassign/check`, {
        json: { order_id: first.requestId, to_engineer_id: otherEngineer, force: false },
      }),
    );
  } else {
    await skip(
      '14_reassign-check.json',
      'POST /planning/{id}/reassign/check',
      'нет опубликованного плана или второго инженера',
    );
  }

  // 15. Инженер
  const engineer = await login('engineer', '15_engineer-login.json');
  if (engineer) {
    await step('15_engineer-day.json', 'GET /engineers/me/day', () =>
      call('GET', '/engineers/me/day', { token: engineer }),
    );
    await step('15_engineer-route.json', 'GET /engineers/me/route?remaining=true', () =>
      call('GET', '/engineers/me/route', { token: engineer, query: { remaining: true } }),
    );
  }

  // 16. Оператор
  const operator = await login('operator', '16_operator-login.json');
  if (operator) {
    await step('16_booking-slots.json', `GET /booking/slots (${REGION}, ${TEST_DATE})`, () =>
      call('GET', '/booking/slots', {
        token: operator,
        query: {
          region_id: REGION,
          date: TEST_DATE,
          type_bk: 'Подключение',
          type_hd: 'Заявка на подключение',
        },
      }),
    );
    await step('16_booking-search.json', 'GET /booking/requests?q=Москва', () =>
      call('GET', '/booking/requests', { token: operator, query: { q: 'Москва' } }),
    );
  }

  // 17. Синтетика: отдельной ручки загрузки нет (⏳) — ищем уже загруженный синтетический сценарий.
  await snapshotSynthetic(asDispatcher);

  await printSummary();
}

async function snapshotSynthetic(asDispatcher) {
  const label = 'синтетический сценарий';
  try {
    const openapi = await call('GET', `${new URL(API_URL).origin}/openapi.json`);
    const special = Object.keys(openapi?.paths ?? {}).filter((p) =>
      /synth|instance|bench/i.test(p),
    );
    if (special.length) {
      await skip(
        '17_synthetic-scenario.json',
        label,
        `в схеме есть ${special.join(', ')} — дописать вызов по контракту бэка`,
      );
      return;
    }
    const list = await asDispatcher('GET', '/data/scenarios', {
      query: { source: 'json', limit: 20 },
    });
    for (const item of (list?.items ?? []).slice(0, 5)) {
      const scenario = await asDispatcher('GET', `/data/scenarios/${item.scenario_id}`);
      if (!isSyntheticScenario(scenario)) continue;
      await save('17_synthetic-scenario.json', scenario);
      results.push({
        file: '17_synthetic-scenario.json',
        label: `GET /data/scenarios/${item.scenario_id}`,
        state: 'ok',
      });
      await step('17_synthetic-plan.json', 'POST /planning/run (синтетика)', () =>
        asDispatcher('POST', '/planning/run', {
          json: { scenario_id: item.scenario_id, seed: 42, include_baseline: true },
        }),
      );
      return;
    }
    await skip(
      '17_synthetic-scenario.json',
      label,
      'пропущено: ручки загрузки синтетики нет, синтетических сценариев на стенде нет',
    );
  } catch (error) {
    await skip('17_synthetic-scenario.json', label, `пропущено: ${error?.message ?? error}`);
  }
}

async function printSummary() {
  const mark = { ok: '✓', failed: '✗', skipped: '–' };
  console.log('Шаги:');
  for (const result of results) {
    const note = result.note ? ` — ${result.note}` : '';
    console.log(`  ${mark[result.state]} ${result.file.padEnd(30)} ${result.label}${note}`);
  }
  const files = (await readdir(OUT_DIR)).filter((file) => file.endsWith('.json')).sort();
  const failed = results.filter((result) => result.state === 'failed');
  const skipped = results.filter((result) => result.state === 'skipped');
  console.log(
    `\nФайлов в docs/api-examples: ${files.length}. Упало: ${failed.length}. Пропущено: ${skipped.length}.`,
  );
  if (failed.length) console.log(`Упали: ${failed.map((result) => result.file).join(', ')}`);
  if (!results.some((result) => result.state === 'ok')) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Снимок прерван:', error);
  process.exitCode = 1;
});
