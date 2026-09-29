import { describe, expect, it, vi } from 'vitest';
import type { BaselineResponse, CompareResponse } from '@/api/types';
import {
  makeEngineer,
  makeEvent,
  makePlan,
  makePlanItem,
  makePoint,
  makeRegion,
  makeRequest,
  makeRoute,
  makeScenario,
} from './__fixtures__/day';
import { buildCompare, inWindow, lateCount } from './compare';
import { assignmentSummary, constraintRows, otherEngineers, unassignedExplain } from './constraints';
import { buildDayModel } from './dayModel';
import { resolveDayChain } from './dayChain';
import { buildFeed } from './feed';
import { routeLines } from './geo';
import {
  cancelEvent,
  changedAssignments,
  diffCounters,
  diffGroups,
  maxShiftEnd,
  metricsLine,
  urgentDecision,
  urgentEvent,
} from './proposal';

const scenario = makeScenario({
  engineers: [
    makeEngineer({ id: 'e1', name: 'Бригада Соколов', skills: ['installation', 'local'], skills_display: ['Подключение и дозаказ', 'Локальные работы'] }),
    makeEngineer({ id: 'e2', name: 'Бригада Мельников' }),
    makeEngineer({ id: 'e3', name: 'Бригада Попов', skills: ['local'], skills_display: ['Локальные работы'] }),
    makeEngineer({ id: 'e4', name: 'Бригада Перов', transport: 'walk', transport_display: 'Пешком' }),
  ],
  requests: [
    makeRequest({
      id: '305838184',
      window_start: '18:00',
      window_end: '20:00',
      required_transport: 'car',
      required_transport_display: 'Автомобиль',
      type_hd: 'Работа с кабелем',
      dispatcher_engineer_id: 'e2',
    }),
    makeRequest({ id: '305830002', window_start: '14:00', window_end: '16:00', dispatcher_engineer_id: 'e2' }),
  ],
});

const plan = makePlan({
  plan_id: 'P1',
  summary: {
    engineers_used: 1,
    total_distance_km: 42.3,
    planned_count: 1,
    total_requests: 2,
    unassigned_count: 1,
    unassigned_urgent: 0,
    objective: [],
  },
  routes: [
    makeRoute('e1', [
      makePoint({
        request_id: '305838184',
        sequence: 7,
        arrival: '17:52',
        start: '18:00',
        end: '19:10',
        waiting_minutes: 8,
        slack_minutes: 38,
        leg_distance_km: 3.2,
        window_start: '18:00',
        window_end: '20:00',
      }),
    ]),
  ],
  unassigned: [{ request_id: '305830002', reason_code: 'NO_CAPACITY', reason: 'Нет свободных.', proven_static: false }],
  explanations: [
    {
      request_id: '305838184',
      status: 'assigned',
      engineer_id: 'e1',
      summary: 'Заявка назначена',
      reasons: [],
      local_alternatives: [{ engineer_id: 'e2', position: 3, delta_engineers: 1, delta_distance_km: 4.2 }],
    },
  ],
});

const model = buildDayModel({
  date: '2026-09-28',
  region: makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
  scenario,
  plan,
});

describe('constraints', () => {
  const request = model.requestById.get('305838184')!;
  const engineer = model.engineerById.get('e1')!;

  it('три строки по фактам плана, формулировки макета', () => {
    const rows = constraintRows(request.visit!, request, engineer);
    expect(rows.map((r) => [r.label, r.ok])).toEqual([
      ['Квалификация', true],
      ['Время', true],
      ['Ресурс', true],
    ]);
    expect(rows[0].text).toBe('Нужен навык «Подключение и дозаказ», у бригады есть');
    expect(rows[1].text).toBe(
      'Приезд 17:52, ждёт окна 8 мин, начало 18:00 (окно 18–20), окончание 19:10, смена до 22:00, запас 38 мин',
    );
    expect(rows[2].text).toBe('Нужен автомобиль (работа с кабелем), бригада на автомобиле');
  });

  it('несоответствие — строка как есть и предупреждение в консоль', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const walker = model.engineerById.get('e4')!;
    const rows = constraintRows(request.visit!, request, walker);
    expect(rows[2]).toMatchObject({ ok: false, text: 'Нужен автомобиль (работа с кабелем), бригада пешком' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('строка «Почему этот инженер»', () => {
    expect(assignmentSummary(request.visit!, request, engineer)).toBe(
      'Бригада Соколов: есть навык «Подключение и дозаказ», начнёт в 18:00 в окне 18–20, едет на автомобиле, 3,2 км от предыдущей заявки.',
    );
  });

  it('«Почему не другие»: сначала альтернативы, затем навык и транспорт', () => {
    const rows = otherEngineers(model, request, plan.explanations![0]);
    expect(rows.map((r) => [r.label, r.reason])).toEqual([
      ['Бригада Мельников', 'ещё +1 инженер в работе, пробег +4,2 км'],
      ['Бригада Попов', 'нет навыка'],
      ['Бригада Перов', 'пешком, а нужен автомобиль'],
    ]);
  });

  it('неназначенная: причина по шаблону с подходящими бригадами и «Что поможет»', () => {
    const request2 = model.requestById.get('305830002')!;
    const explain = unassignedExplain(model, request2, 'NO_CAPACITY', 'Нет свободных.');
    expect(explain.reason).toBe(
      'Все подходящие инженеры заняты в окне 14–16: Бригада Соколов, Бригада Мельников, Бригада Перов',
    );
    expect(explain.help).toBe('Добавьте инженера или переназначьте вручную менее срочную заявку');
    expect(unassignedExplain(model, request2, 'SOMETHING', 'Текст бэка.').reason).toBe('Текст бэка');
  });
});

describe('compare', () => {
  const compare: CompareResponse = {
    columns: {
      incremental: { engineers_used: 0, km_total: 0, coverage_pct: 0, unassigned_urgent: 0, violations: 0, km_is_estimate: false, available: true },
      fifo: { engineers_used: 2, km_total: 60, coverage_pct: 50, unassigned_urgent: 0, violations: 0, km_is_estimate: false, available: true },
      dispatcher: { engineers_used: 1, km_total: 55.5, coverage_pct: 100, unassigned_urgent: 0, violations: 0, km_is_estimate: true, available: true },
    },
    km_by_engineer: { fifo: { e1: 30, e2: 30 }, dispatcher: { e2: 55.5 }, incremental: { e1: 0 } },
    notes: [],
  };
  const baseline = {
    plan_id: 'P1',
    baseline: { engineers_used: 2, total_distance_km: 60, planned_count: 1, total_requests: 2, unassigned_count: 1, unassigned_urgent: 0 },
    baseline_routes: [makeRoute('e2', [makePoint({ request_id: '305838184', sequence: 1, start: '20:30', window_start: '18:00', window_end: '20:00' })], { distance_km: 30 })],
  } as unknown as BaselineResponse;

  it('три колонки и Δ к FIFO', () => {
    const cmp = buildCompare({ model, plan, compare, baseline });
    const byKey = Object.fromEntries(cmp.rows.map((r) => [r.key, r]));
    expect(byKey.engineers.ours).toEqual({ value: '1', delta: '−1 инженер' });
    expect(byKey.km.ours).toEqual({ value: '42,3', delta: '−17,7 км (−30%)' });
    expect(byKey.km.dispatcher).toEqual({ value: '55,5', note: 'оценка' });
    expect(byKey.unassigned.dispatcher.value).toBe('0');
    expect(byKey.inWindow.ours.value).toBe('1/1');
    expect(byKey.inWindow.fifo.value).toBe('0/1');
    expect(byKey.late.fifo.value).toBe('1');
    expect(cmp.note).toBe('Δ — к базовому FIFO. Пробег реального диспетчера — оценка.');
    const e2 = cmp.engineers.find((e) => e.engineerId === 'e2')!;
    expect(e2).toMatchObject({ ours: null, fifo: 30, dispatcher: 55.5, tasksDispatcher: 2, tasksFifo: 1 });
    // «Наш» по бригаде — из маршрута плана, а не из нулевого incremental
    expect(cmp.engineers.find((e) => e.engineerId === 'e1')?.ours).toBeCloseTo(3.2);
  });

  it('пробег диспетчера по бригадам: одни нули — «нет данных»', () => {
    const cmp = buildCompare({
      model,
      plan,
      compare: { ...compare, km_by_engineer: { dispatcher: { e1: 0, e2: 0 } } },
      baseline: null,
    });
    expect(cmp.engineers.every((e) => e.dispatcher === null)).toBe(true);
  });

  it('до плана: «Наш план» — прочерки, подсказка; нет диспетчера — «нет данных»', () => {
    const cmp = buildCompare({
      model,
      plan: null,
      compare: { columns: { fifo: compare.columns!.fifo }, km_by_engineer: {}, notes: [] },
      baseline: null,
    });
    expect(cmp.rows[0].ours.value).toBe('—');
    expect(cmp.rows[0].fifo.value).toBe('2');
    expect(cmp.rows[0].dispatcher).toEqual({ value: 'нет данных', note: 'контрольный файл не загружен' });
    expect(cmp.note).toMatch(/^Нажмите «Построить план»/);
  });

  it('день из записей оператора: диспетчера нет — «только для CSV-дня»', () => {
    const cmp = buildCompare({
      model: { ...model, source: 'booking', fromCsv: false },
      plan: null,
      compare: { columns: { fifo: compare.columns!.fifo }, km_by_engineer: {}, notes: [] },
      baseline: null,
    });
    expect(cmp.rows[0].dispatcher).toEqual({ value: 'нет данных', note: 'только для CSV-дня' });
  });

  it('диспетчер не сопоставлен (0 бригад, 0% охвата) — «нет данных»', () => {
    const cmp = buildCompare({
      model,
      plan,
      compare: {
        columns: {
          fifo: compare.columns!.fifo,
          dispatcher: { engineers_used: 0, km_total: 0, coverage_pct: 0, unassigned_urgent: 0, violations: 0, km_is_estimate: true, available: true },
        },
        km_by_engineer: {},
        notes: [],
      },
      baseline: null,
    });
    expect(cmp.rows[1].dispatcher).toEqual({ value: 'нет данных', note: 'назначения не сопоставлены с бригадами' });
  });

  it('P1-8: колонка plan — «Наш план» тем же расчётом, что FIFO; недоступна — сводка плана', () => {
    const withPlan: CompareResponse = {
      ...compare,
      columns: {
        ...compare.columns,
        plan: {
          engineers_used: 1, km_total: 40.1, coverage_pct: 100, unassigned: 0, visits_total: 1, started_in_window: 1, late: 0,
          unassigned_urgent: 0, violations: 0, km_is_estimate: false, available: true,
          km_by_engineer: [{ engineer_id: 'e1', km: 40.1, tasks: 1 }],
        },
      },
    };
    const byKey = Object.fromEntries(buildCompare({ model, plan, compare: withPlan, baseline }).rows.map((r) => [r.key, r]));
    expect(byKey.km.ours).toEqual({ value: '40,1', delta: '−19,9 км (−33%)' });
    expect(byKey.unassigned.ours.value).toBe('0');
    const e1 = buildCompare({ model, plan, compare: withPlan, baseline }).engineers.find((e) => e.engineerId === 'e1');
    expect(e1?.ours).toBeCloseTo(40.1);

    const unavailable = { ...compare, columns: { ...compare.columns, plan: { available: false } } } as unknown as CompareResponse;
    const fallback = Object.fromEntries(buildCompare({ model, plan, compare: unavailable, baseline }).rows.map((r) => [r.key, r]));
    expect(fallback.km.ours.value).toBe('42,3');
  });

  it('inWindow и lateCount', () => {
    const routes = [makeRoute('e1', [makePoint({ request_id: 'a', sequence: 1, start: '12:30', window_start: '10:00', window_end: '12:00' }), makePoint({ request_id: 'b', sequence: 2, start: '13:00', window_start: '12:00', window_end: '14:00', flags: ['late'] })])];
    expect(inWindow(routes)).toEqual({ n: 1, m: 2 });
    expect(lateCount(routes)).toBe(2);
  });
});

describe('proposal', () => {
  const summary = { reassigned: 2, reordered: 1, time_shifted: 4, added: 1, removed: 0, newly_unassigned: 0, newly_assigned: 0, untouched: 61 };

  it('счётчики и N баннера', () => {
    expect(diffCounters(summary).map((c) => `${c.label} ${c.n}`)).toEqual([
      'Передано 2',
      'Новый порядок 1',
      'Сдвиг времени 4',
      'Добавлено 1',
      'Без исполнителя 0',
      'Не тронуто 61',
    ]);
    expect(changedAssignments(summary)).toBe(4);
  });

  it('группы по бригадам, передача — в группе «откуда»', () => {
    const groups = diffGroups(
      {
        changes: [
          { type: 'added', request_id: 'U-0001', engineer_id: 'e1', new_start: '13:25' },
          { type: 'time_shifted', request_id: '305855129', engineer_id: 'e1', old_start: '14:00', new_start: '15:00', delta_minutes: 60 },
          { type: 'reassigned', request_id: '305837780', from_engineer_id: 'e1', to_engineer_id: 'e2', old_start: '16:00', new_start: '16:20' },
          { type: 'reordered', request_id: '305852310', engineer_id: 'e1', old_position: 2, new_position: 1 },
          { type: 'weird', request_id: '1' },
        ],
      },
      {
        engineerById: model.engineerById,
        requestById: model.requestById,
        baseEngineerOf: () => null,
        newOrderOf: () => ['305852310', 'U-0001', '305855129'],
        requestInfo: (id) => (id === 'U-0001' ? { typeShort: 'Авария', duration: 80 } : null),
        engineerOrder: ['e1', 'e2'],
      },
    );
    expect(groups[0].label).toBe('Бригада Соколов');
    expect(groups[0].items.map((i) => `${i.label}: ${i.text}`)).toEqual([
      'Добавлена: U-0001 · Авария · 13:25–14:45',
      'Сдвиг: №…5129: 14:00 → 15:00 (+60 мин)',
      'Передана: №…7780: Бригада Соколов → Бригада Мельников, 16:00 → 16:20',
      'Новый порядок: …2310, U-0001, …5129',
    ]);
    // номера заявок — отдельными кусками: в окне предложения это ссылки на карточку
    const refs = (index: number) =>
      groups[0].items[index].parts.flatMap((part) => (typeof part === 'string' ? [] : [part.requestId]));
    expect(refs(3)).toEqual(['305852310', 'U-0001', '305855129']);
    expect(refs(1)).toEqual(['305855129']);
    expect(groups[0].items[3].parts[1]).toBe(', ');
    expect(groups.at(-1)?.items[0].label).toBe('Изменение: weird');
  });

  it('итоговая строка метрик', () => {
    expect(
      metricsLine({
        metrics_before: { engineers_used: 10, km_total: 286.5 },
        metrics_after: { engineers_used: 10, km_total: 293 },
      }),
    ).toBe('Инженеров 10 → 10 · Пробег 286,5 → 293,0 км (+6,5 км)');
  });

  it('карточка решения по аварии: из scenario.urgent, реакция > 2 ч — флаг', () => {
    const decision = urgentDecision(
      model,
      { urgent: { order_id: 'U-1', engineer_id: 'e1', arrival: '13:25', start: '13:25', reaction_min: 135, reaction_target_min: 120 } },
      null,
      '11:10',
      'U-1',
    );
    expect(decision).toMatchObject({ engineerLabel: 'Бригада Соколов', arrival: '13:25', reactionMin: 135, late: true });
    const fromDiff = urgentDecision(
      model,
      null,
      { changes: [{ type: 'added', request_id: 'U-1', engineer_id: 'e2', new_start: '13:00' }] },
      '12:30',
      'U-1',
    );
    expect(fromDiff).toMatchObject({ engineerId: 'e2', reactionMin: 30, late: false });
  });

  it('тела событий: apply и source добавит api, окно аварии — до конца смены', () => {
    const event = urgentEvent(
      { planId: 'P1', eventTime: '12:30', address: ' Волгоградский пр-т, 128 ', typeHd: 'Авария', transport: 'car', shiftEnd: maxShiftEnd(model) },
      'U-TEST',
    );
    expect(event).toEqual({
      type: 'urgent_order_added',
      plan_id: 'P1',
      event_time: '12:30',
      request: {
        id: 'U-TEST',
        address: 'Волгоградский пр-т, 128',
        duration_minutes: 80,
        window_start: '12:30',
        window_end: '22:00',
        priority: 'urgent',
        required_skill: 'emergency',
        required_transport: 'car',
        type_bk: 'Глобальная проблема',
        type_hd: 'Авария',
        source: 'dispatcher',
      },
    });
    expect(cancelEvent('P1', '12:40', '305838184', 'other', '  ')).toMatchObject({ params: { reason: 'other' } });
  });
});

describe('feed', () => {
  it('шаблоны, «Ждёт решения» только у предложений к текущей версии', () => {
    const events = [
      makeEvent({
        event_id: 'E2',
        event_type: 'engineer_unavailable',
        plan_id: 'P1',
        result_plan_id: 'P3',
        payload: { engineer_id: 'e2', time: '13:40', scenario: { engineer_unavailable: { unassigned_count: 2 } } },
        created_at: '2026-09-28T10:41:00Z',
      }),
      makeEvent({
        event_id: 'E1',
        plan_id: 'P1',
        result_plan_id: 'P2',
        needs_decision: true,
        payload: { request_id: 'U-0001', time: '12:30', scenario: { urgent: { order_id: 'U-0001', engineer_id: 'e1', arrival: '13:25' } } },
        created_at: '2026-09-28T09:31:00Z',
      }),
    ];
    const chain = resolveDayChain(
      makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
      events,
      [
        { plan_id: 'P1', scenario_id: 'S0', kind: 'optimized', status: 'applied', created_at: '', version: 0, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
        { plan_id: 'P2', scenario_id: 'S1', kind: 'replanned', status: 'rejected', created_at: '', version: 0, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
        { plan_id: 'P3', scenario_id: 'S2', kind: 'replanned', status: 'proposed', created_at: '', version: 0, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
      ],
    );
    const rows = buildFeed({ chain, model });
    expect(rows.map((r) => [r.time, r.text, r.needsDecision, r.note])).toEqual([
      ['13:40', 'Бригада Мельников недоступна с 13:40: 2 без исполнителя', true, null],
      ['12:30', 'Авария №U-0001 → Бригада Соколов, прибытие 13:25', false, 'Отклонено'],
    ]);
    expect(rows[0].action).toEqual({ label: 'Открыть', planId: 'P3', kind: 'open' });
    expect(rows[0].chip?.label).toBe('Ждёт решения');
  });
});

describe('feed: события бэка 28.09', () => {
  it('plan_applied — номер версии из цепочки, «Принято в HH:MM»; факты инженера — с именами', () => {
    const events = [
      makeEvent({
        event_id: 'F1',
        event_type: 'engineer_action',
        plan_id: 'P1',
        payload: { action: 'complete', request_id: '305838184', engineer_id: 'e1', event_time: '14:05', headline: 'Инженер e1 выполнил №305838184' },
        created_at: '2026-09-28T11:05:00Z',
      }),
      makeEvent({
        event_id: 'A2',
        event_type: 'plan_applied',
        plan_id: 'P1',
        result_plan_id: 'P2',
        applied_at: '12:34',
        payload: { headline: 'Версия 1 применена. Инженеры получили обновление', applied_at: '12:34' },
        created_at: '2026-09-28T09:34:00Z',
      }),
      makeEvent({
        event_id: 'E1',
        plan_id: 'P1',
        result_plan_id: 'P2',
        payload: { request_id: 'U-0001', time: '12:30', headline: 'Авария №U-0001 → e1, прибытие 13:25', scenario: { urgent: { order_id: 'U-0001', engineer_id: 'e1', arrival: '13:25' } } },
        created_at: '2026-09-28T09:31:00Z',
      }),
    ];
    const chain = resolveDayChain(
      makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
      events,
      [
        { plan_id: 'P1', scenario_id: 'S0', kind: 'optimized', status: 'superseded', created_at: '', version: 1, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
        { plan_id: 'P2', scenario_id: 'S1', kind: 'replanned', status: 'applied', created_at: '', version: 1, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
      ],
    );
    const rows = buildFeed({ chain, model });
    expect(rows.map((r) => [r.time, r.text, r.note])).toEqual([
      ['14:05', 'Бригада Соколов выполнила №…8184', null],
      ['12:34', 'Версия 2 применена. Инженеры получили обновление', null],
      ['12:30', 'Авария №U-0001 → Бригада Соколов, прибытие 13:25', 'Принято в 12:34 · версия 2'],
    ]);
  });
});

describe('feed: «Прервать» инженера', () => {
  const failEvent = (resultPlan: string) =>
    makeEvent({
      event_id: `X-${resultPlan}`,
      event_type: 'order_cancelled',
      plan_id: 'P1',
      result_plan_id: resultPlan,
      payload: { order_id: '305838184', reason: 'client_refused', source: 'engineer', event_time: '12:30' },
      created_at: '2026-09-28T09:31:00Z',
    });
  const plans = (status: string) => [
    { plan_id: 'P1', scenario_id: 'S0', kind: 'optimized', status: 'applied', created_at: '', version: 1, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
    { plan_id: 'P2', scenario_id: 'S1', kind: 'replanned', status, created_at: '', version: 0, engineers_used: 1, total_distance_km: 1, planned_count: 1 },
  ];

  it('«— требует решения» — только пока предложение ждёт решения', () => {
    const region = makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 });
    const pending = buildFeed({ chain: resolveDayChain(region, [failEvent('P2')], plans('proposed')), model });
    const rejected = buildFeed({ chain: resolveDayChain(region, [failEvent('P2')], plans('rejected')), model });
    expect(pending[0]).toMatchObject({ needsDecision: true, action: { label: 'Решить', planId: 'P2' } });
    expect(pending[0].text).toMatch(/— требует решения$/);
    expect(rejected[0]).toMatchObject({ needsDecision: false, note: 'Отклонено' });
    expect(rejected[0].text).not.toMatch(/требует решения/);
  });
});

describe('feed: устаревшее и исправленное вручную предложение', () => {
  it('устаревшее — «Пересчитать», исправленное вручную — «Принято с правкой»', () => {
    const region = makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 });
    const events = [
      makeEvent({ event_id: 'U1', plan_id: 'P1', result_plan_id: 'P2', created_at: '2026-09-28T12:40:00Z', payload: { request_id: 'U-1' } }),
      makeEvent({ event_id: 'U2', plan_id: 'P1', result_plan_id: 'P3', created_at: '2026-09-28T12:41:00Z', payload: { request_id: 'U-2' } }),
      makeEvent({
        event_id: 'F1',
        event_type: 'order_cancelled',
        plan_id: 'P2',
        result_plan_id: 'P4',
        created_at: '2026-09-28T12:50:00Z',
        payload: { request_id: '305838184', reason: 'no_access', source: 'engineer' },
      }),
      makeEvent({
        event_id: 'M1',
        event_type: 'manual_reassign',
        plan_id: 'P4',
        result_plan_id: 'P5',
        created_at: '2026-09-28T12:55:00Z',
        payload: { order_id: '305838184', to_engineer_id: 'e1' },
      }),
    ];
    const plans = [
      makePlanItem({ plan_id: 'P1', status: 'superseded', version: 1 }),
      makePlanItem({ plan_id: 'P2', scenario_id: 'S1', status: 'superseded' }),
      makePlanItem({ plan_id: 'P3', scenario_id: 'S2', status: 'proposed' }),
      makePlanItem({ plan_id: 'P4', scenario_id: 'S3', status: 'proposed' }),
      makePlanItem({ plan_id: 'P5', scenario_id: 'S4', status: 'applied' }),
    ];
    const rows = new Map(buildFeed({ chain: resolveDayChain(region, events, plans), model }).map((r) => [r.id, r]));
    expect(rows.get('U2')).toMatchObject({
      needsDecision: true,
      chip: { label: 'Устарело' },
      action: { label: 'Пересчитать', planId: 'P3', kind: 'resend' },
    });
    expect(rows.get('F1')).toMatchObject({ needsDecision: false, action: null, note: 'Принято с правкой вручную · версия 3' });
    expect(rows.get('M1')?.note).toBe('Принято · версия 3');
  });
});

describe('feed: кто прервал заявку', () => {
  it('бригада из нажатия «Прервать», а не нынешний владелец заявки после пересчёта', () => {
    const region = makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 });
    const events = [
      makeEvent({
        event_id: 'A1',
        event_type: 'engineer_action',
        plan_id: 'P1',
        created_at: '2026-09-28T09:30:00Z',
        payload: { action: 'fail', request_id: '305838184', engineer_id: 'e2' },
      }),
      makeEvent({
        event_id: 'X1',
        event_type: 'order_cancelled',
        plan_id: 'P1',
        result_plan_id: 'P2',
        created_at: '2026-09-28T09:31:00Z',
        payload: { request_id: '305838184', reason: 'client_refused', source: 'engineer' },
      }),
    ];
    const plans = [makePlanItem({ plan_id: 'P1', status: 'applied', version: 1 }), makePlanItem({ plan_id: 'P2', scenario_id: 'S1', status: 'rejected' })];
    const row = buildFeed({ chain: resolveDayChain(region, events, plans), model }).find((r) => r.id === 'X1');
    expect(row?.text).toBe('Бригада Мельников: «Клиент отказался» по №…8184');
  });
});

describe('feed: инцидент инженера', () => {
  it('текст с именем бригады, без кнопки решения', () => {
    const chain = resolveDayChain(
      makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
      [
        makeEvent({
          event_id: 'I1',
          event_type: 'incident',
          plan_id: 'P1',
          needs_decision: true,
          payload: { headline: 'Инцидент у инженера e1: лопнуло колесо', engineer_id: 'e1', event_time: '13:10' },
        }),
      ],
      [{ plan_id: 'P1', scenario_id: 'S0', kind: 'optimized', status: 'applied', created_at: '', version: 1, engineers_used: 1, total_distance_km: 1, planned_count: 1 }],
    );
    const [row] = buildFeed({ chain, model });
    expect(row).toMatchObject({ time: '13:10', text: 'Бригада Соколов: инцидент — лопнуло колесо', tone: 'warning', action: null });
  });
});

describe('compare: формат бэка 28.09', () => {
  it('поля колонки и km_by_engineer {бригада: {стратегия: {km, tasks}}}', () => {
    const cmp = buildCompare({
      model,
      plan,
      compare: {
        columns: {
          fifo: {
            available: true, engineers_used: 2, km_total: 60, coverage_pct: 50, unassigned: 1, visits_total: 1,
            started_in_window: 0, late: 1, unassigned_urgent: 0, violations: 0, km_is_estimate: false,
            km_by_engineer: [{ engineer_id: 'e2', km: 30, tasks: 1 }],
          },
          dispatcher: { available: false, violations: 0, km_is_estimate: false },
        },
        km_by_engineer: { e2: { fifo: { km: 30, tasks: 1 } } },
        notes: [],
      },
      baseline: null,
    });
    const byKey = Object.fromEntries(cmp.rows.map((r) => [r.key, r]));
    expect(byKey.inWindow.fifo.value).toBe('0/1');
    expect(byKey.late.fifo.value).toBe('1');
    expect(byKey.unassigned.fifo.value).toBe('1');
    expect(byKey.engineers.dispatcher).toEqual({ value: 'нет данных', note: 'контрольный файл не загружен' });
    expect(cmp.engineers.find((e) => e.engineerId === 'e2')).toMatchObject({ fifo: 30, tasksFifo: 1 });
  });
});

describe('geo', () => {
  it('линии из GeoJSON [lon, lat]; без GeoJSON — прямые отрезки', () => {
    const lines = routeLines(model, {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[37.82, 55.72], [37.8, 55.75]] },
          properties: { feature_type: 'route', engineer_id: 'e1', geometry_source: 'local_osrm:car' },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [37.8, 55.75] }, properties: { feature_type: 'request' } },
      ],
    });
    expect(lines).toEqual([{ engineerId: 'e1', points: [[55.72, 37.82], [55.75, 37.8]], road: true }]);
    expect(routeLines(model, null)).toEqual([{ engineerId: 'e1', points: [[55.72, 37.82], [55.75, 37.8]], road: false }]);
  });
});
