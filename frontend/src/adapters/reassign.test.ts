import { describe, expect, it } from 'vitest';
import type { ReassignCheckResponse } from '@/api/types';
import {
  makeEngineer,
  makePlan,
  makePoint,
  makeRegion,
  makeRequest,
  makeRoute,
  makeScenario,
} from './__fixtures__/day';
import { buildDayModel } from './dayModel';
import {
  candidateBadge,
  candidateInfo,
  checkLabel,
  consequenceChips,
  engineersDelta,
  freeAt,
  idleToday,
  haversineKm,
  inferPosition,
  minPosition,
  positionOptions,
  reassignCandidates,
  routeStops,
  summarizeCheck,
} from './reassign';

const all = ['local', 'installation', 'emergency'];
const allDisplay = ['Локальные работы', 'Подключение и дозаказ', 'Аварийные работы'];

const scenario = makeScenario({
  engineers: [
    makeEngineer({
      id: 'e1',
      name: 'Бригада Соколов',
      skills: ['installation', 'local'],
      skills_display: allDisplay.slice(0, 2),
    }),
    makeEngineer({
      id: 'e2',
      name: 'Бригада Мельников',
      skills: all,
      latitude: 55.76,
      longitude: 37.8,
    }),
    makeEngineer({
      id: 'e3',
      name: 'Бригада Попов',
      skills: ['local'],
      skills_display: ['Локальные работы'],
    }),
    makeEngineer({
      id: 'e4',
      name: 'Бригада Перов',
      transport: 'walk',
      transport_display: 'Пешком',
      latitude: 55.751,
      longitude: 37.8,
    }),
    makeEngineer({ id: 'e5', name: 'Бригада Гусаковский', latitude: 55.7, longitude: 37.8 }),
    makeEngineer({ id: 'e6', name: 'Бригада Каушнян', available: false }),
    makeEngineer({ id: 'e7', name: 'Бригада Зверев', shift_status: 'finished' }),
  ],
  requests: [
    makeRequest({ id: '305800001', window_start: '10:00', window_end: '12:00' }),
    makeRequest({
      id: '305866410',
      type_bk: 'Локальная заявка',
      required_skill: 'installation',
      required_transport: 'car',
      required_transport_display: 'Автомобиль',
      window_start: '14:00',
      window_end: '16:00',
      latitude: 55.75,
      longitude: 37.8,
    }),
    makeRequest({ id: '305800003', window_start: '10:00', window_end: '12:00' }),
    makeRequest({ id: '305800004', window_start: '12:00', window_end: '14:00' }),
  ],
});

const plan = makePlan({
  plan_id: 'P1',
  routes: [
    makeRoute('e1', [
      makePoint({
        request_id: '305800001',
        sequence: 1,
        start: '10:05',
        end: '11:15',
        status: 'done',
        actual_end: '11:05',
      }),
      makePoint({
        request_id: '305866410',
        sequence: 2,
        start: '14:00',
        end: '15:10',
        latitude: 55.75,
        longitude: 37.8,
      }),
    ]),
    makeRoute(
      'e2',
      [
        makePoint({
          request_id: '305800003',
          sequence: 1,
          start: '10:05',
          end: '11:15',
          latitude: 55.755,
          longitude: 37.8,
        }),
        makePoint({
          request_id: '305800004',
          sequence: 2,
          start: '12:10',
          end: '13:20',
          latitude: 55.77,
          longitude: 37.8,
        }),
      ],
      { start_latitude: 55.76, start_longitude: 37.8 },
    ),
  ],
});

const model = buildDayModel({
  date: '2026-09-28',
  region: makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
  scenario,
  plan,
});
const request = model.requestById.get('305866410')!;

const check = (patch: Partial<ReassignCheckResponse>): ReassignCheckResponse => ({
  order_id: '305866410',
  to_engineer_id: 'e2',
  feasible: true,
  checks: {},
  new_start: '14:40',
  shifted_visits: [],
  late_visits: [],
  delta_km: 2.8,
  ...patch,
});

describe('кандидаты DS-08', () => {
  it('без текущей и снятых со смены; прошедшие фильтр — по близости, отсеянные — вниз', () => {
    const list = reassignCandidates(model, request);
    expect(list.map((c) => [c.engineer.id, c.filter, c.checkNow])).toEqual([
      ['e2', null, true],
      ['e5', null, true],
      ['e4', 'transport', false],
      ['e3', 'skill', false],
    ]);
  });

  it('проверяем сразу не больше `limit` ближайших', () => {
    const list = reassignCandidates(model, request, 1);
    expect(list.filter((c) => c.checkNow).map((c) => c.engineer.id)).toEqual(['e2']);
  });

  it('расстояние — от ближайшей точки маршрута или старта', () => {
    const [e2] = reassignCandidates(model, request);
    // ближайшая точка e2 — заявка …0003 в 0,005° к северу от заявки
    expect(e2.distanceKm).toBeCloseTo(haversineKm([55.755, 37.8], [55.75, 37.8]), 5);
    expect(e2.distanceKm).toBeCloseTo(0.56, 1);
  });
});

describe('check → три ограничения', () => {
  it('ключи сводим к «Квалификация / Время / Ресурс»', () => {
    expect(
      [
        'skill',
        'qualification',
        'time',
        'window',
        'shift',
        'transport',
        'resource',
        'equipment',
      ].map(checkLabel),
    ).toEqual([
      'Квалификация',
      'Квалификация',
      'Время',
      'Время',
      'Время',
      'Ресурс',
      'Ресурс',
      'Ресурс',
    ]);
  });

  it('feasible — «Подходит», нарушений нет', () => {
    const summary = summarizeCheck(
      check({ checks: { skill: { ok: true, text: 'Навык есть' }, time: { ok: true, text: '' } } }),
      request,
    );
    expect(summary).toMatchObject({
      feasible: true,
      verdict: 'ok',
      violations: [],
      newStart: '14:40',
      deltaKm: 2.8,
    });
  });

  it('нарушено только время — «Вне окна», текст бэка после «Время: »', () => {
    const summary = summarizeCheck(
      check({
        feasible: false,
        new_start: null,
        checks: {
          skill: { ok: true, text: '' },
          time: { ok: false, text: 'Не помещается в окно и смену у выбранного инженера.' },
        },
      }),
      request,
    );
    expect(summary.verdict).toBe('window');
    expect(summary.violations).toEqual([
      { label: 'Время', text: 'не помещается в окно и смену у выбранного инженера' },
    ]);
  });

  it('несколько нарушений — «Нарушение»; пустой текст — шаблон; оборудование — тоже «Ресурс»', () => {
    const summary = summarizeCheck(
      check({
        feasible: false,
        new_start: '16:40',
        checks: {
          transport: { ok: false, text: '' },
          equipment: { ok: false },
          time: { ok: false, text: '' },
          skill: { ok: true },
        },
        late_visits: [{ order_id: '305867214', late_min: 20 }],
      }),
      request,
    );
    expect(summary.verdict).toBe('violation');
    expect(summary.violations).toEqual([
      { label: 'Время', text: 'начало 16:40 вне окна 14–16' },
      { label: 'Ресурс', text: 'нужен автомобиль; нет нужного оборудования' },
    ]);
    expect(summary.lateIds).toEqual(['305867214']);
  });

  it('незнакомая форма ответа не роняет разбор', () => {
    const summary = summarizeCheck(
      {
        order_id: 'x',
        to_engineer_id: 'e2',
        feasible: false,
        delta_km: Number.NaN,
        checks: { time: 'нет' },
      },
      request,
    );
    expect(summary).toMatchObject({
      verdict: 'violation',
      violations: [],
      deltaKm: 0,
      lateIds: [],
      newStart: null,
    });
  });
});

describe('метка и подпись кандидата', () => {
  const [e2, , e4] = reassignCandidates(model, request);
  const ok = summarizeCheck(check({}), request);
  const late = summarizeCheck(
    check({ feasible: false, new_start: '16:20', checks: { time: { ok: false } } }),
    request,
  );
  const bad = summarizeCheck(
    check({
      feasible: false,
      new_start: '16:40',
      checks: { time: { ok: false }, transport: { ok: false } },
    }),
    request,
  );

  it('метка по ответу check; у отсеянного — «Нет авто» и после проверки', () => {
    expect(candidateBadge(e2, request, null)).toBeNull();
    expect(candidateBadge(e2, request, ok)).toMatchObject({ text: 'Подходит', tone: 'success' });
    expect(candidateBadge(e2, request, late)).toMatchObject({ text: 'Вне окна', tone: 'danger' });
    expect(candidateBadge(e2, request, bad)).toMatchObject({ text: 'Нарушение', tone: 'danger' });
    expect(candidateBadge(e4, request, bad)).toMatchObject({ text: 'Нет авто', tone: 'danger' });
    expect(candidateBadge({ filter: 'skill' }, request, ok)?.text).toBe('Нет навыка');
  });

  it('подписи как в макете: «свободен · км», «занят до», «пешком · начало», без проверки — «пешком · км»', () => {
    expect(candidateInfo(e2, { summary: ok, free: '14:20' })).toBe('свободен 14:20 · 0,6 км');
    expect(candidateInfo(e2, { summary: ok, free: null })).toBe('начало 14:40 · 0,6 км');
    expect(candidateInfo(e2, { summary: late, free: '16:10' })).toBe('занят до 16:10');
    expect(candidateInfo(e4, { summary: bad, free: '12:00' })).toBe('пешком · начало 16:40');
    expect(candidateInfo(e4, null)).toBe('пешком · 0,1 км');
  });
});

describe('позиция в маршруте', () => {
  const stopsE1 = routeStops(model, 'e1', '305866410');
  const stopsE2 = routeStops(model, 'e2');

  it('точки маршрута без переназначаемой заявки; выполненная — закреплена, окончание — по факту', () => {
    expect(stopsE1).toEqual([
      { requestId: '305800001', number: '№305800001', start: '10:05', end: '11:05', locked: true },
    ]);
    expect(minPosition(stopsE1)).toBe(1);
    expect(minPosition(stopsE2)).toBe(0);
  });

  it('позиция «лучшей» вставки — по новому началу', () => {
    expect(inferPosition(stopsE2, '14:40')).toBe(2);
    expect(inferPosition(stopsE2, '12:00')).toBe(1);
    expect(inferPosition(stopsE2, '09:30')).toBe(0);
    expect(inferPosition(stopsE1, '09:30')).toBe(1);
    expect(inferPosition(stopsE2, null)).toBeNull();
  });

  it('свободна: окончание предыдущей точки или начало смены', () => {
    expect(freeAt(stopsE2, 2, '10:00')).toBe('13:20');
    expect(freeAt(stopsE2, 0, '10:00')).toBe('10:00');
    expect(freeAt(stopsE2, null, '10:00')).toBeNull();
  });

  it('варианты: «В начало маршрута» и «После №…», у выбранного — начало из check', () => {
    expect(positionOptions(stopsE2, 2, '14:40')).toEqual([
      { value: '0', label: 'В начало маршрута' },
      { value: '1', label: 'После №305800003' },
      { value: '2', label: 'После №305800004 · начало 14:40' },
    ]);
    // перед выполненной заявкой вставить нельзя
    expect(positionOptions(stopsE1, null, null).map((o) => o.value)).toEqual(['1']);
    expect(positionOptions([], 0, '10:30')).toEqual([
      { value: '0', label: 'В начало маршрута · начало 10:30' },
    ]);
  });
});

describe('чипы-последствия', () => {
  it('«Инженеров ±N»: маршрут «откуда» опустел −1, маршрут «куда» был пуст +1', () => {
    const lone = buildDayModel({
      date: '2026-09-28',
      region: makeRegion({ active_plan_id: 'P2', plan_state: 'applied', version: 1 }),
      scenario,
      plan: makePlan({
        plan_id: 'P2',
        routes: [
          makeRoute('e1', [makePoint({ request_id: '305866410', sequence: 1 })]),
          makeRoute('e2', [makePoint({ request_id: '305800003', sequence: 1 })]),
        ],
      }),
    });
    const moved = lone.requestById.get('305866410')!;
    expect(engineersDelta(lone, moved, 'e2')).toBe(-1);
    expect(engineersDelta(lone, moved, 'e5')).toBe(0);
    expect(engineersDelta(model, request, 'e5')).toBe(1);
    expect(engineersDelta(model, request, 'e2')).toBe(0);
    // неназначенная: «откуда» нет
    expect(engineersDelta(model, { id: 'U-1', engineerId: null }, 'e5')).toBe(1);
  });

  it('просрочка, пробег и инженеры — единым форматом Δ', () => {
    const numberOf = (id: string) => `№${id}`;
    expect(consequenceChips({ lateIds: [], deltaKm: 2.8 }, 0, numberOf)).toEqual([
      'Уйдут в просрочку: нет',
      'Пробег +2,8 км',
      'Инженеров 0',
    ]);
    expect(consequenceChips({ lateIds: ['1', '2', '3'], deltaKm: -1.25 }, -1, numberOf)).toEqual([
      'Уйдут в просрочку: №1, №2 и ещё 1',
      'Пробег −1,3 км',
      'Инженеров −1',
    ]);
  });
});

describe('idleToday — бригада сегодня не работает (D-38)', () => {
  it('ответ бэка `engineer_idle_today` важнее; без него — нет заявок в текущем плане', () => {
    expect(idleToday({ used: false }, null)).toBe(true);
    expect(idleToday({ used: true }, null)).toBe(false);
    expect(idleToday({ used: false }, { idleToday: false })).toBe(false);
    expect(idleToday({ used: true }, { idleToday: true })).toBe(true);
    expect(idleToday({ used: false }, { idleToday: null })).toBe(true);
  });
});

