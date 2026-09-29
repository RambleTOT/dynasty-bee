import { describe, expect, it } from 'vitest';
import {
  makeEngineer,
  makePlan,
  makePoint,
  makeRegion,
  makeRequest,
  makeRoute,
  makeScenario,
} from './__fixtures__/day';
import { buildDayModel, matchesFilters } from './dayModel';

const scenario = makeScenario({
  engineers: [
    makeEngineer({ id: 'e2', name: 'Бригада Мельников', transport: 'walk', transport_display: 'Пешком' }),
    makeEngineer({ id: 'e1', name: 'Бригада Соколов' }),
  ],
  requests: [
    makeRequest({ id: '305838184', window_start: '18:00', window_end: '20:00' }),
    makeRequest({
      id: '305830001',
      type_bk: 'Глобальная проблема',
      type_hd: 'Авария',
      required_skill: 'emergency',
      priority: 'urgent',
      status: 'planned',
    }),
    makeRequest({ id: '305830002', type_bk: 'Локальная заявка', required_skill: 'local', status: 'planned' }),
  ],
});

const plan = makePlan({
  plan_id: 'P1',
  routes: [
    makeRoute('e1', [
      makePoint({ request_id: '305838184', sequence: 2, start: '18:00', status: 'done', flags: ['changed', 'weird'] }),
      makePoint({ request_id: '305830001', sequence: 1, start: '13:25' }),
    ]),
  ],
  unassigned: [{ request_id: '305830002', reason_code: 'NO_CAPACITY', reason: 'Все заняты', proven_static: false }],
});

describe('buildDayModel', () => {
  const model = buildDayModel({
    date: '2026-09-28',
    region: makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
    scenario,
    plan,
    chain: { version: 3, pendingProposals: [] },
  });

  it('бригады по id, цвет по позиции, задействованность и транспорт', () => {
    expect(model.engineers.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(model.engineerById.get('e1')).toMatchObject({
      short: 'Соколов',
      used: true,
      taskCount: 2,
      color: { index: 1 },
    });
    expect(model.engineerById.get('e2')).toMatchObject({ used: false, transportLabel: 'Пешком', color: { index: 2 } });
  });

  it('визиты по sequence; статус и флаги назначенной — из точки маршрута', () => {
    expect(model.routeByEngineer.get('e1')?.visits.map((v) => v.requestId)).toEqual(['305830001', '305838184']);
    const done = model.requestById.get('305838184');
    expect(done).toMatchObject({ status: 'done', flags: ['changed'], engineerId: 'e1', windowShort: '18–20' });
  });

  it('авария: красный маркер по HD «Авария», чип «Срочная» по приоритету', () => {
    expect(model.requestById.get('305830001')).toMatchObject({ emergency: true, urgent: true, typeShort: 'Авария' });
    expect(model.requestById.get('305830001')?.flags).toContain('urgent');
  });

  it('«Глобальная проблема» + HD «Информация» — не авария (D-37): без молнии, «Информ.»; «Срочная» — как у бэка', () => {
    const info = buildDayModel({
      date: '2026-09-28',
      region: makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
      scenario: makeScenario({
        engineers: scenario.engineers,
        requests: [
          makeRequest({
            id: '305830003',
            type_bk: 'Глобальная проблема',
            type_hd: 'Информация',
            required_skill: 'emergency',
            priority: 'urgent',
            status: 'planned',
          }),
        ],
      }),
      plan: makePlan({ plan_id: 'P1', routes: [makeRoute('e1', [makePoint({ request_id: '305830003', sequence: 1 })])] }),
    });
    // пока бэк не сделал 13.1, «Срочная» у «Информации» остаётся — фронт её не прячет
    expect(info.requestById.get('305830003')).toMatchObject({ emergency: false, urgent: true, typeShort: 'Информ.' });
  });

  it('неназначенная по плану получает статус «Не назначена»', () => {
    expect(model.requestById.get('305830002')?.status).toBe('unassigned');
    expect(model.unassigned).toEqual([{ requestId: '305830002', reasonCode: 'NO_CAPACITY', reason: 'Все заняты' }]);
  });

  it('версия и предложения — из цепочки, ось — из смен', () => {
    expect(model.version).toBe(3);
    expect(model.planId).toBe('P1');
    expect(model.axis).toEqual({ start: 600, end: 1320 });
    expect(model.fromCsv).toBe(true);
    expect(model.office?.point).toEqual([55.72, 37.82]);
  });

  it('dispatcher_engineer_id с именем бригады сопоставляется с id', () => {
    const m = buildDayModel({
      date: '2026-09-28',
      region: makeRegion(),
      scenario: makeScenario({
        engineers: [makeEngineer({ id: 'E01', name: 'Бригада Горбанев' })],
        requests: [makeRequest({ id: 'R1', dispatcher_engineer_id: 'Бригада Горбанев' })],
      }),
      plan: null,
    });
    expect(m.requestById.get('R1')?.dispatcherEngineerId).toBe('E01');
  });

  it('фильтр «Тип заявки» по BK', () => {
    expect(model.typeOptions.map((o) => o.value)).toEqual(['Подключение', 'Локальная заявка', 'Глобальная проблема']);
    const connection = model.requestById.get('305838184')!;
    expect(matchesFilters(connection, { status: null, type: 'Подключение' })).toBe(true);
    expect(matchesFilters(connection, { status: 'planned', type: null })).toBe(false);
  });
});

describe('синтетический день', () => {
  const synthetic = makeScenario({
    source: 'json',
    engineers: [
      makeEngineer({ id: 'E00', name: 'E00', shift_start: '09:00', shift_end: '19:00', latitude: 0, longitude: 0 }),
    ],
    requests: [
      makeRequest({ id: 'T000', type_bk: null, type_hd: null, address: null, district: null, required_skill: 'local', latitude: 2, longitude: 2 }),
      makeRequest({ id: 'T001', type_bk: null, type_hd: null, address: null, district: null, required_skill: 'emergency', latitude: 4, longitude: 4 }),
    ],
  });
  const model = buildDayModel({
    date: '2026-09-28',
    region: makeRegion({ source: 'json' }),
    scenario: synthetic,
    plan: null,
  });

  it('признак синтетики и условные координаты перенесены к офису', () => {
    expect(model.synthetic).toBe(true);
    expect(model.coordsApprox).toBe(true);
    const [lat, lon] = model.requestById.get('T000')!.point!;
    expect(Math.abs(lat - 55.72)).toBeLessThan(0.1);
    expect(Math.abs(lon - 37.82)).toBeLessThan(0.1);
  });

  it('подписи по навыку и ось 09–19', () => {
    expect(model.requestById.get('T001')).toMatchObject({ typeShort: 'Авария', addressText: 'Адрес не указан', number: '№T001' });
    expect(model.engineers[0].label).toBe('Бригада E00');
    expect(model.axis).toEqual({ start: 540, end: 1140 });
    expect(model.typeOptions.map((o) => o.label)).toEqual(['Локальные работы', 'Авария']);
    expect(model.fromCsv).toBe(false);
  });
});
