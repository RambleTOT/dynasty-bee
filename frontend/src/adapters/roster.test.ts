import { describe, expect, it } from 'vitest';
import type { EngineerOut, ExtendResourceCheckResponse, ExtendResourceResponse, RequestOut } from '@/api/types';
import { makeEngineer, makePlan } from './__fixtures__/day';
import { overlayEngineers, overlayModel } from './__fixtures__/dayOverlays';
import {
  commonShift,
  createdEngineerId,
  EMPTY_DRAFT,
  engineerAddedEvent,
  extraEngineer,
  pendingLock,
  resourceAdvice,
  rosterDiff,
  rosterEvent,
  rosterRows,
  setChange,
  transportOptions,
  validateNewEngineer,
  type NewEngineer,
} from './roster';

const model = overlayModel();
const rows = rosterRows(overlayEngineers, model);
const row = (id: string) => rows.find((r) => r.id === id)!;

const newcomer: NewEngineer = {
  key: 'n1',
  name: '  Бригада Иванов ',
  skills: ['emergency'],
  transport: 'car',
  shiftStart: '10:00',
  shiftEnd: '22:00',
};

describe('строки ростера DS-09', () => {
  it('подписи, сокращения навыков, транспорт, смена из данных, «В день»', () => {
    expect(row('e1')).toMatchObject({
      label: 'Бригада Соколов',
      skillChips: ['Лок.', 'Подкл.', 'Авария'],
      transport: 'car',
      shiftText: '10:00–22:00',
      available: true,
      color: model.engineerById.get('e1')!.color,
    });
    expect(row('e5').available).toBe(false);
  });

  it('фактический транспорт важнее справочного; пустые поля не роняют', () => {
    const [changed] = rosterRows(
      [makeEngineer({ id: 'x1', name: 'x1', actual_transport: 'bike' })],
      model,
    );
    expect(changed).toMatchObject({ label: 'Бригада x1', transport: 'bike' });
    expect(
      rosterRows([{ id: 'x2' } as EngineerOut, null as unknown as EngineerOut], model),
    ).toMatchObject([{ id: 'x2', skills: [], skillChips: [], available: true, shiftText: '–' }]);
  });

  it('смена новой бригады — самая частая в ростере; пусто — нет', () => {
    const shifts = [
      { shiftStart: '09:00', shiftEnd: '19:00' },
      { shiftStart: '10:00', shiftEnd: '22:00' },
      { shiftStart: '09:00', shiftEnd: '19:00' },
    ];
    expect(commonShift(shifts)).toEqual({ start: '09:00', end: '19:00' });
    expect(commonShift([])).toBeNull();
  });

  it('варианты транспорта: справочник и незнакомый с бэка', () => {
    expect(transportOptions('car').map((o) => o.label)).toEqual([
      'Автомобиль',
      'Общ. транспорт',
      'Пешком',
      'Велосипед',
    ]);
    expect(transportOptions('scooter').at(-1)).toEqual({ value: 'scooter', label: 'scooter' });
  });
});

describe('черновик и дифф состава', () => {
  it('правка и возврат к исходному значению', () => {
    let draft = setChange(EMPTY_DRAFT, row('e1'), 'transport', 'walk');
    draft = setChange(draft, row('e3'), 'available', false);
    expect(draft.changes).toEqual({ e1: { transport: 'walk' }, e3: { available: false } });
    draft = setChange(draft, row('e1'), 'transport', 'car');
    expect(draft.changes).toEqual({ e3: { available: false } });
  });

  it('PATCH только изменённых полей, POST новых; count — число изменений', () => {
    let draft = setChange(EMPTY_DRAFT, row('e2'), 'transport', 'bike');
    draft = setChange(draft, row('e2'), 'available', false);
    draft = setChange(draft, row('e5'), 'available', true);
    draft = { ...draft, additions: [newcomer] };
    expect(rosterDiff(rows, draft)).toEqual({
      patches: [
        { engineerId: 'e2', patch: { transport: 'bike', available: false } },
        { engineerId: 'e5', patch: { available: true } },
      ],
      additions: [
        {
          name: 'Бригада Иванов',
          skills: ['emergency'],
          transport: 'car',
          shift_start: '10:00',
          shift_end: '22:00',
          start: 'office',
        },
      ],
      count: 4,
    });
  });

  it('после публикации: одно изменение → событие, блокировка остального', () => {
    const planId = 'P1';
    const at = '14:32';
    const transport = setChange(EMPTY_DRAFT, row('e1'), 'transport', 'public_transport');
    expect(rosterEvent(rosterDiff(rows, transport), planId, at)).toEqual({
      type: 'transport_changed',
      plan_id: 'P1',
      event_time: '14:32',
      engineer_id: 'e1',
      params: { transport: 'public_transport' },
    });
    expect(pendingLock(rows, transport)).toEqual({
      kind: 'engineer',
      engineerId: 'e1',
      field: 'transport',
    });

    const off = setChange(EMPTY_DRAFT, row('e2'), 'available', false);
    expect(rosterEvent(rosterDiff(rows, off), planId, at)).toMatchObject({
      type: 'engineer_unavailable',
      engineer_id: 'e2',
    });
    const on = setChange(EMPTY_DRAFT, row('e5'), 'available', true);
    expect(rosterEvent(rosterDiff(rows, on), planId, at)).toMatchObject({
      type: 'engineer_available',
      engineer_id: 'e5',
    });

    const two = setChange(off, row('e1'), 'transport', 'walk');
    expect(rosterEvent(rosterDiff(rows, two), planId, at)).toBeNull();
    expect(pendingLock(rows, { ...EMPTY_DRAFT, additions: [newcomer] })).toEqual({
      kind: 'addition',
    });
    expect(pendingLock(rows, EMPTY_DRAFT)).toBeNull();
  });

  it('id новой бригады — по разнице ростера и имени', () => {
    const before = ['e1', 'e2'];
    const after = [
      makeEngineer({ id: 'e1' }),
      makeEngineer({ id: 'e2' }),
      makeEngineer({ id: 'e9', name: 'Бригада Петров' }),
      makeEngineer({ id: 'e10', name: 'Бригада Иванов' }),
    ];
    expect(createdEngineerId(before, after, 'Бригада Иванов')).toBe('e10');
    expect(createdEngineerId(before, after.slice(0, 3), 'Бригада Иванов')).toBe('e9');
    expect(createdEngineerId(before, after, 'Бригада Сидоров')).toBeNull();
  });

  it('проверка формы добавления', () => {
    expect(validateNewEngineer(newcomer)).toEqual({});
    expect(
      validateNewEngineer({
        ...newcomer,
        name: ' ',
        skills: [],
        shiftStart: '18:00',
        shiftEnd: '10:00',
      }),
    ).toEqual({
      name: 'Укажите имя',
      skills: 'Выберите хотя бы один навык',
      shift: 'Начало смены должно быть раньше окончания',
    });
  });
});

describe('рекомендация «не хватает +N инженера» (extend-resource)', () => {
  const candidate = { skills: ['emergency'], transport: 'car' };
  const proposal = (closed?: string[], still?: string[]) =>
    ({
      plan: makePlan({ plan_id: 'P5', status: 'proposed' }),
      closed,
      still_unassigned: still,
      cost: { extra_engineers: 1, delta_km: 12.4 },
    }) as unknown as ExtendResourceResponse;
  const check = (closed: string[], still: string[]): ExtendResourceCheckResponse => ({
    closed,
    still_unassigned: still,
    cost: { extra_engineers: 1 },
  });

  it('кандидат закрыл часть заявок: навык по-русски, «на автомобиле», остаток — без исполнителя', () => {
    expect(resourceAdvice(proposal(['a', 'b', 'c'], ['d']), 4, candidate)).toEqual({
      text: 'Чтобы назначить 3 неназначенные, не хватает +1 инженера с навыком «Аварийные работы» и на автомобиле; ещё 1 заявка останется без исполнителя',
      tone: 'info',
      proposalId: 'P5',
      helps: true,
    });
  });

  it('расчёт без сохранения (P1-5): предложения нет; формы слов; несколько навыков; пешком', () => {
    expect(
      resourceAdvice(check(['a', 'b', 'c', 'd', 'e'], []), 5, { skills: ['installation', 'local'], transport: 'walk' }),
    ).toEqual({
      text: 'Чтобы назначить 5 неназначенных, не хватает +1 инженера с навыками «Подключение и дозаказ», «Локальные работы» и пешком',
      tone: 'info',
      proposalId: null,
      helps: true,
    });
    expect(resourceAdvice(check(['a'], []), 1, candidate).text).toMatch(/^Чтобы назначить 1 неназначенную,/);
  });

  it('кандидат ничего не закрыл — предупреждение, добавлять его нет смысла', () => {
    expect(resourceAdvice(check([], ['a', 'b']), 2, candidate)).toMatchObject({ tone: 'warning', helps: false });
  });

  it('ответ без closed — «Не удалось рассчитать добор ресурса»', () => {
    expect(resourceAdvice(proposal(undefined), 3, candidate)).toEqual({
      text: 'Не удалось рассчитать добор ресурса',
      tone: 'warning',
      proposalId: null,
      helps: false,
    });
    expect(resourceAdvice(null, 3, candidate).text).toBe('Не удалось рассчитать добор ресурса');
  });
});

describe('бригада-кандидат для добора', () => {
  const request = (patch: Partial<RequestOut>) => ({ raw: { id: 'x', ...patch } as RequestOut });

  it('навыки неназначенных, автомобиль, самая частая смена, старт — офис', () => {
    expect(
      extraEngineer(
        [request({ required_skill: 'emergency', required_transport: 'car' }), request({ required_skill: 'local' })],
        rows,
        [55.7, 37.76],
      ),
    ).toMatchObject({
      id: 'EXTRA-1',
      skills: ['local', 'emergency'],
      transport: 'car',
      shift_start: commonShift(rows)?.start,
      shift_end: commonShift(rows)?.end,
      latitude: 55.7,
      longitude: 37.76,
      start_kind: 'office',
    });
  });

  it('нет навыков, смены или точки старта — кандидата нет', () => {
    expect(extraEngineer([request({ required_skill: 'unknown' })], rows, [55.7, 37.76])).toBeNull();
    expect(extraEngineer([request({ required_skill: 'local' })], [], [55.7, 37.76])).toBeNull();
    expect(extraEngineer([request({ required_skill: 'local' })], rows, null)).toBeNull();
  });
});

describe('новая бригада после публикации (P1-6)', () => {
  it('событие engineer_added: id выдаёт бэк, старт — офис', () => {
    const [addition] = rosterDiff(rows, { ...EMPTY_DRAFT, additions: [newcomer] }).additions;
    expect(engineerAddedEvent(addition, 'P1', '12:30', [55.7, 37.76])).toEqual({
      type: 'engineer_added',
      plan_id: 'P1',
      event_time: '12:30',
      engineer: {
        name: 'Бригада Иванов',
        skills: ['emergency'],
        transport: 'car',
        shift_start: '10:00',
        shift_end: '22:00',
        start: { kind: 'office' },
        latitude: 55.7,
        longitude: 37.76,
      },
    });
  });
});
