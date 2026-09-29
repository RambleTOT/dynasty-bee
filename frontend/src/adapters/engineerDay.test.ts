import { describe, expect, it } from 'vitest';
import type { EngineerMeDay, EngineerVisit } from '@/api/types';
import {
  currentVisit,
  hasActiveVisit,
  latestBanner,
  pageState,
  pendingOutcomes,
  plannedLeft,
  routeGroups,
  shiftSummary,
  toEngineerDay,
  mergeDay,
  statusAfterFail,
  withFailedVisits,
  withVisitStatus,
} from './engineerDay';

/** Визит в форме ответа /engineers/me/day (FRONTEND_SPEC §5.2). */
function visit(id: string, sequence: number, status: string, extra: Partial<EngineerVisit> = {}) {
  return {
    request_id: id,
    sequence,
    status,
    flags: [],
    type_bk: 'Подключение',
    type_hd: 'Конвергенция абонента',
    address: `Город Москва, ул.Окская, д. ${sequence}, кв. 1`,
    window: '14:00-16:00',
    arrival: '14:10',
    start: '14:20',
    duration_minutes: 70,
    leg_km: 1.6,
    gigabit: false,
    why_you: '',
    ...extra,
  } as EngineerVisit;
}

function day(visits: EngineerVisit[], extra: Partial<EngineerMeDay> = {}): EngineerMeDay {
  return {
    date: '2026-09-29',
    plan_published: true,
    engineer: {
      id: 'E01',
      name: 'Бригада Мельников',
      transport: 'car',
      shift_start: '10:00',
      shift_end: '22:00',
      shift_status: 'on_shift',
    },
    summary: { total: visits.length, done: 0 },
    active_request_id: null,
    visits,
    banners: [],
    ...extra,
  };
}

const model = (visits: EngineerVisit[], extra: Partial<EngineerMeDay> = {}) =>
  toEngineerDay(day(visits, extra));

describe('currentVisit (D-30)', () => {
  it('active_request_id — текущая', () => {
    const d = model([visit('A', 1, 'done'), visit('B', 2, 'en_route'), visit('C', 3, 'planned')], {
      active_request_id: 'B',
    });
    expect(currentVisit(d)?.id).toBe('B');
  });

  it('без active_request_id — первая planned по sequence, а не по порядку в ответе', () => {
    const d = model([visit('C', 3, 'planned'), visit('B', 2, 'planned'), visit('A', 1, 'done')]);
    expect(currentVisit(d)?.id).toBe('B');
  });

  it('«Отменяется» и «Переносится» текущими не бывают, даже если бэк оставил active_request_id', () => {
    const d = model(
      [
        visit('A', 1, 'cancel_pending'),
        visit('B', 2, 'reschedule_pending'),
        visit('C', 3, 'planned'),
      ],
      { active_request_id: 'A' },
    );
    expect(currentVisit(d)?.id).toBe('C');
  });

  it('заявка в работе без active_request_id — текущая', () => {
    const d = model([visit('A', 1, 'planned'), visit('B', 2, 'in_progress')]);
    expect(currentVisit(d)?.id).toBe('B');
  });

  it('всё закрыто — текущей нет', () => {
    const d = model([
      visit('A', 1, 'done'),
      visit('B', 2, 'cancelled'),
      visit('C', 3, 'cancel_pending'),
    ]);
    expect(currentVisit(d)).toBeNull();
  });
});

describe('routeGroups', () => {
  it('«Далее»: сначала ждущие решения, затем planned по sequence; «Завершённые» отдельно', () => {
    const d = model([
      visit('A', 1, 'done'),
      visit('B', 2, 'cancelled'),
      visit('C', 3, 'in_progress'),
      visit('F', 6, 'planned'),
      visit('E', 5, 'planned'),
      visit('D', 4, 'cancel_pending'),
    ]);
    const groups = routeGroups(d);
    expect(groups.current?.id).toBe('C');
    expect(groups.waiting.map((v) => v.id)).toEqual(['D']);
    expect(groups.upcoming.map((v) => v.id)).toEqual(['E', 'F']);
    expect(groups.completed.map((v) => v.id)).toEqual(['A', 'B']);
  });

  it('после «Прервать» текущей становится следующая', () => {
    const d = model([visit('A', 1, 'reschedule_pending'), visit('B', 2, 'planned')]);
    const groups = routeGroups(d);
    expect(groups.current?.id).toBe('B');
    expect(groups.waiting.map((v) => v.id)).toEqual(['A']);
    expect(groups.upcoming).toEqual([]);
  });

  it('счётчики для «Завершить смену»', () => {
    const d = model([
      visit('A', 1, 'en_route'),
      visit('B', 2, 'planned'),
      visit('C', 3, 'planned'),
    ]);
    expect(plannedLeft(d)).toBe(2);
    expect(hasActiveVisit(d)).toBe(true);
    expect(hasActiveVisit(model([visit('B', 2, 'planned')]))).toBe(false);
  });
});

describe('pageState (§9.1)', () => {
  const engineer = (shift_status?: string) => ({
    id: 'E01',
    name: 'Бригада Мельников',
    ...(shift_status ? { shift_status } : {}),
  });

  it('план не опубликован', () => {
    expect(pageState(model([visit('A', 1, 'planned')], { plan_published: false }))).toBe(
      'unpublished',
    );
  });

  it('заявок нет', () => {
    expect(pageState(model([]))).toBe('empty');
  });

  it('по статусу смены', () => {
    const v = [visit('A', 1, 'planned')];
    expect(pageState(model(v, { engineer: engineer('not_started') }))).toBe('preview');
    expect(pageState(model(v, { engineer: engineer('on_shift') }))).toBe('shift');
    expect(pageState(model(v, { engineer: engineer('unavailable') }))).toBe('unavailable');
    expect(pageState(model(v, { engineer: engineer('finished') }))).toBe('finished');
  });

  it('смена завершена — итоги, даже если заявок не осталось', () => {
    expect(pageState(model([], { engineer: engineer('finished') }))).toBe('finished');
  });

  it('нет plan_published — считаем опубликованным', () => {
    const raw = day([visit('A', 1, 'planned')]);
    delete raw.plan_published;
    expect(pageState(toEngineerDay(raw))).toBe('shift');
  });

  it('нет shift_status — по визитам', () => {
    expect(pageState(model([visit('A', 1, 'planned')], { engineer: engineer() }))).toBe('preview');
    expect(pageState(model([visit('A', 1, 'done')], { engineer: engineer() }))).toBe('shift');
  });
});

describe('toEngineerDay: подписи и запасные пути', () => {
  it('заголовок, адрес, окно, время', () => {
    const [v] = model([visit('305871402', 4, 'planned', { arrival: '15:32:00' })]).visits;
    expect(v.title).toBe('Конвергенция абонента');
    expect(v.address).toBe('ул.Окская, д. 4, кв. 1');
    expect(v.addressShort).toBe('ул.Окская, д. 4');
    expect(v.windowShort).toBe('14–16');
    expect(v.windowFull).toBe('14:00–16:00');
    expect(v.arrival).toBe('15:32');
  });

  it('синтетика: заголовок по навыку, адреса нет, имя бригады по id', () => {
    const d = model(
      [
        visit('T000', 1, 'planned', {
          type_bk: null,
          type_hd: null,
          address: null,
          required_skill: 'emergency',
        } as Partial<EngineerVisit>),
      ],
      { engineer: { id: 'E00', name: 'E00', shift_status: 'on_shift' } },
    );
    expect(d.visits[0].title).toBe('Авария');
    expect(d.visits[0].address).toBe('');
    expect(d.engineer.name).toBe('Бригада E00');
  });

  it('незнакомый статус и флаги не показываем', () => {
    const d = model([
      visit('A', 1, 'teleported'),
      visit('B', 2, 'planned', { flags: ['urgent', 'mystery', 'urgent'] }),
    ]);
    expect(d.visits.map((v) => v.id)).toEqual(['B']);
    expect(d.visits[0].flags).toEqual(['urgent']);
  });

  it('всего и «первая в …» — из summary, иначе по визитам', () => {
    const withSummary = model([visit('A', 1, 'planned')], {
      summary: { total: 9, first_start: '10:20' },
    });
    expect(withSummary.total).toBe(9);
    expect(withSummary.firstStart).toBe('10:20');
    const bare = model([visit('B', 2, 'planned', { arrival: '11:50' }), visit('A', 1, 'planned')], {
      summary: {},
    });
    expect(bare.total).toBe(2);
    expect(bare.firstStart).toBe('14:10');
  });

  it('цвет маршрута: color_index ⏳, иначе --route-1', () => {
    expect(model([]).engineer.routeColor).toBe(1);
    const colored = model([], {
      engineer: { id: 'E01', color_index: 13, shift_status: 'on_shift' },
    });
    expect(colored.engineer.routeColor).toBe(2);
  });

  it('старт смены: офис или дом', () => {
    const d = model([], {
      engineer: {
        id: 'E01',
        shift_status: 'not_started',
        start: { kind: 'office', address: 'Город Москва, ул.Юных Ленинцев, д. 83 стр. 4' },
      },
    });
    expect(d.engineer.start).toEqual({ kind: 'office', address: 'ул.Юных Ленинцев, д. 83 стр. 4' });
  });

  it('оборудование ⏳ — только из поля визита', () => {
    const d = model([
      visit('A', 1, 'planned', { equipment: { 'Smart Box Turbo': 1, 'UTP 5e': 2 } }),
      visit('B', 2, 'planned', { equipment: {} }),
      visit('C', 3, 'planned'),
    ]);
    expect(d.visits.map((v) => v.equipment)).toEqual(['Smart Box Turbo, UTP 5e × 2', null, null]);
  });
});

describe('баннер «План изменён» (E-09)', () => {
  const banners = [
    {
      type: 'order_changed',
      text: 'Порядок изменён: №…7695 теперь 7-я',
      at: '12:40',
      request_id: '305857695',
    },
    { type: 'urgent_added', text: 'Новая срочная заявка №U-1 — после текущей', at: '13:05' },
    { type: 'cancel_confirmed', text: 'Отмена №…1402 подтверждена', at: '12:10' },
  ];

  it('ключ просмотра — seen_banner_<at>_<type>', () => {
    const d = model([], { banners });
    expect(d.banners.map((b) => b.key)).toEqual([
      'seen_banner_12:40_order_changed',
      'seen_banner_13:05_urgent_added',
      'seen_banner_12:10_cancel_confirmed',
    ]);
    expect(d.banners[0].requestId).toBe('305857695');
  });

  it('самый свежий непросмотренный', () => {
    const d = model([], { banners });
    expect(latestBanner(d.banners, () => false)?.at).toBe('13:05');
    const seen = new Set(['seen_banner_13:05_urgent_added']);
    expect(latestBanner(d.banners, (key) => seen.has(key))?.at).toBe('12:40');
    expect(latestBanner(d.banners, () => true)).toBeNull();
  });

  it('баннер без текста не показываем', () => {
    expect(model([], { banners: [{ type: 'x', text: ' ' }] }).banners).toEqual([]);
  });
});

describe('итоги смены (E-10)', () => {
  it('по shift_totals', () => {
    const d = model([visit('A', 1, 'done')], {
      engineer: { id: 'E01', shift_status: 'finished' },
      shift_totals: {
        done: 6,
        total: 7,
        started_in_window: 6,
        km: 28.4,
        minutes_travel: 130,
        minutes_work: 340,
        minutes_wait: 35,
        interrupted: 1,
        started_at: '10:00',
        ended_at: '21:35',
      },
    });
    expect(shiftSummary(d)).toEqual({
      done: 6,
      total: 7,
      startedInWindow: 6,
      km: 28.4,
      interrupted: 1,
      minutesTravel: 130,
      minutesWork: 340,
      minutesWait: 35,
      startedAt: '10:00',
      endedAt: '21:35',
    });
  });

  it('без shift_totals — «Выполнено» и «Прервано» по визитам, остальное пусто', () => {
    const d = model([
      visit('A', 1, 'done'),
      visit('B', 2, 'done'),
      visit('C', 3, 'cancel_pending'),
      visit('D', 4, 'planned'),
    ]);
    expect(shiftSummary(d)).toMatchObject({
      done: 2,
      total: 4,
      interrupted: 1,
      startedInWindow: null,
      km: null,
      minutesTravel: null,
      startedAt: null,
    });
  });
});

describe('withVisitStatus — оптимистичный статус', () => {
  it('в пути — заявка становится активной', () => {
    const raw = day([visit('A', 1, 'planned'), visit('B', 2, 'planned')]);
    const next = withVisitStatus(raw, 'A', 'en_route');
    expect(next.visits?.[0].status).toBe('en_route');
    expect(next.active_request_id).toBe('A');
    expect(raw.visits?.[0].status).toBe('planned');
  });

  it('выполнена — активной нет, текущей становится следующая', () => {
    const raw = day([visit('A', 1, 'in_progress'), visit('B', 2, 'planned')], {
      active_request_id: 'A',
    });
    const next = withVisitStatus(raw, 'A', 'done');
    expect(next.active_request_id).toBeNull();
    expect(currentVisit(toEngineerDay(next))?.id).toBe('B');
  });
});

describe('withFailedVisits — «Прервать» поверх ответа бэка (8.2)', () => {
  it('бэк оставил прерванную «В пути» — она «Отменяется», текущей становится следующая', () => {
    const raw = day([visit('A', 1, 'en_route'), visit('B', 2, 'planned')], { active_request_id: 'A' });
    const { day: next, resolved } = withFailedVisits(raw, new Map([['A', statusAfterFail('client_refused')]]));
    expect(resolved).toEqual([]);
    expect(next.visits?.[0].status).toBe('cancel_pending');
    expect(next.active_request_id).toBeNull();
    expect(currentVisit(toEngineerDay(next))?.id).toBe('B');
  });

  it('инженер уже едет к следующей — текущая она, а не прерванная', () => {
    const raw = day([visit('A', 1, 'en_route'), visit('B', 2, 'en_route')], { active_request_id: 'A' });
    const { day: next } = withFailedVisits(raw, new Map([['A', statusAfterFail('client_reschedule')]]));
    expect(next.visits?.[0].status).toBe('reschedule_pending');
    expect(currentVisit(toEngineerDay(next))?.id).toBe('B');
  });

  it('бэк сам прислал другой статус или заявки нет — решает бэк', () => {
    const raw = day([visit('A', 1, 'cancel_pending'), visit('B', 2, 'planned')]);
    const failed = new Map([
      ['A', statusAfterFail('client_refused')],
      ['C', statusAfterFail('other')],
    ]);
    const { day: next, resolved } = withFailedVisits(raw, failed);
    expect(resolved).toEqual(['A', 'C']);
    expect(next).toBe(raw);
  });
});

describe('mergeDay — ответ действия поверх дня в кэше', () => {
  it('чего нет в ответе действия (date, plan_published, start), берём из прежнего дня', () => {
    const previous = day([visit('A', 1, 'planned')], {
      engineer: {
        id: 'E01',
        name: 'Мельников',
        shift_status: 'not_started',
        start: { kind: 'office' },
      },
      summary: { total: 9, first_start: '10:20' },
    });
    const fromAction: EngineerMeDay = {
      engineer: { id: 'E01', shift_status: 'on_shift', actual_transport: 'walk' },
      summary: { total: 9, done: 0 },
      active_request_id: null,
      visits: [visit('A', 1, 'planned')],
      banners: [],
    };
    const merged = mergeDay(previous, fromAction);
    expect(merged.date).toBe('2026-09-29');
    expect(merged.plan_published).toBe(true);
    expect(merged.engineer).toMatchObject({
      name: 'Мельников',
      shift_status: 'on_shift',
      actual_transport: 'walk',
      start: { kind: 'office' },
    });
    expect(merged.summary).toEqual({ total: 9, done: 0, first_start: '10:20' });
    expect(mergeDay(undefined, fromAction)).toBe(fromAction);
  });

  it('ни имени, ни id бригады — имени нет (шапка возьмёт профиль)', () => {
    expect(model([], { engineer: { id: '' } }).engineer.name).toBe('');
  });
});

describe('pendingOutcomes — решение диспетчера по «Прервать»', () => {
  it('исчезла или закрыта — подтверждено; снова в маршруте — вернули; ещё ждёт — молчим', () => {
    const before = [
      { id: 'A', status: 'cancel_pending' as const },
      { id: 'B', status: 'reschedule_pending' as const },
      { id: 'C', status: 'cancel_pending' as const },
      { id: 'D', status: 'cancel_pending' as const },
      { id: 'E', status: 'planned' as const },
    ];
    const after = [
      { id: 'C', status: 'en_route' as const },
      { id: 'D', status: 'cancel_pending' as const },
      { id: 'E', status: 'planned' as const },
    ];
    expect(pendingOutcomes(before, after)).toEqual([
      { id: 'A', kind: 'cancel_confirmed' },
      { id: 'B', kind: 'reschedule_confirmed' },
      { id: 'C', kind: 'returned' },
    ]);
  });
});

