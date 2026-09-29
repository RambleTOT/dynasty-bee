import { describe, expect, it } from 'vitest';
import type { BookingSearchItem, BookingSlotsResponse } from '@/api/types';
import {
  bookingKey,
  findExact,
  isSlotFree,
  normalizeOutcome,
  normalizeSearch,
  normalizeSearchItem,
  normalizeSlots,
  searchQueries,
  slotsFromError,
} from './booking';

/** Строка поиска по живой схеме 28.09 — без полей ⏳ 9.2. */
const bare: BookingSearchItem = {
  request_id: '305857695',
  region_id: 'east',
  date: '2026-09-29',
  window: '18:00-20:00',
  address: 'ул. Грайвороновская, д. 10 к2, кв. 71',
  type_bk: 'Подключение',
  type_hd: 'Заявка на подключение',
  status: 'planned',
};

describe('normalizeSearchItem', () => {
  it('строка без полей 9.2 → district, gigabit, technology, engineer_name не определены', () => {
    const item = normalizeSearchItem(bare);
    expect(item).toEqual({
      id: '305857695',
      regionId: 'east',
      date: '2026-09-29',
      window: '18:00-20:00',
      address: 'ул. Грайвороновская, д. 10 к2, кв. 71',
      typeBk: 'Подключение',
      typeHd: 'Заявка на подключение',
      status: 'planned',
    });
    expect(item.district).toBeUndefined();
    expect(item.gigabit).toBeUndefined();
    expect(item.technology).toBeUndefined();
    expect(item.requiredTransport).toBeUndefined();
    expect(item.engineerName).toBeUndefined();
  });

  it('поля 9.2 — если пришли', () => {
    const item = normalizeSearchItem({
      ...bare,
      district: 'Текстильщики',
      gigabit: true,
      technology: 'FMC',
      required_transport: 'car',
      engineer_name: 'Бригада Мельников',
    });
    expect(item).toMatchObject({
      district: 'Текстильщики',
      gigabit: true,
      technology: 'FMC',
      requiredTransport: 'car',
      engineerName: 'Бригада Мельников',
    });
  });

  it('инженер null → «не назначен» (null), пустой район — как нет поля', () => {
    const item = normalizeSearchItem({
      ...bare,
      engineer_name: null,
      district: '',
      required_transport: null,
    });
    expect(item.engineerName).toBeNull();
    expect(item.district).toBeUndefined();
    expect(item.requiredTransport).toBeNull();
  });

  it('незнакомый статус и пустые поля — без падения', () => {
    const item = normalizeSearchItem({
      request_id: '1',
      region_id: 'east',
      date: '',
      window: '',
      status: 'archived',
    });
    expect(item.status).toBeNull();
    expect(item.address).toBe('');
    expect(item.typeBk).toBe('');
    expect(item.typeHd).toBeUndefined();
  });
});

describe('normalizeSearch', () => {
  it('новые сверху, не массив — пусто', () => {
    const items = normalizeSearch([
      { ...bare, request_id: 'A', date: '2026-09-22', window: '10:00-12:00' },
      { ...bare, request_id: 'B', date: '2026-09-29', window: '12:00-14:00' },
      { ...bare, request_id: 'C', date: '2026-09-29', window: '18:00-20:00' },
      { ...bare, request_id: 'D', date: '' },
    ]);
    expect(items.map((item) => item.id)).toEqual(['C', 'B', 'A', 'D']);
    expect(normalizeSearch(null)).toEqual([]);
    expect(normalizeSearch({} as unknown as BookingSearchItem[])).toEqual([]);
  });

  it('findExact — только точное совпадение номера', () => {
    const items = normalizeSearch([
      { ...bare, request_id: '3058576951' },
      { ...bare, request_id: '305857695' },
    ]);
    expect(findExact(items, '305857695')?.id).toBe('305857695');
    expect(findExact(items, '30585')).toBeUndefined();
    expect(findExact(items, null)).toBeUndefined();
  });

  it('findExact и bookingKey — номер повторяется в разных днях и регионах', () => {
    const items = normalizeSearch([
      { ...bare, request_id: 'BK-0001', region_id: 'south_east', date: '2026-09-28' },
      { ...bare, request_id: 'BK-0001', region_id: 'south_center', date: '2026-09-29' },
    ]);
    const where = { regionId: 'south_center', date: '2026-09-29' };
    expect(findExact(items, 'BK-0001', where)?.regionId).toBe('south_center');
    expect(findExact(items, 'BK-0001', { regionId: 'east' })).toBeUndefined();
    expect(new Set(items.map(bookingKey)).size).toBe(2);
    expect(bookingKey({ id: 'BK-0001', ...where })).toBe('BK-0001|south_center|2026-09-29');
  });

  it('строка поиска: «ВК-» русскими — «BK-», номер без приставки — ещё и с «BK-», адрес — как есть', () => {
    expect(searchQueries(' ВК-20260930-0001 ')).toEqual(['BK-20260930-0001']);
    expect(searchQueries('вк 2026')).toEqual(['BK-2026']);
    expect(searchQueries('20260930-0001')).toEqual(['20260930-0001', 'BK-20260930-0001']);
    expect(searchQueries('10211')).toEqual(['10211', 'BK-10211']);
    expect(searchQueries('Вкусная, 5')).toEqual(['Вкусная, 5']);
    expect(searchQueries('Грайворон')).toEqual(['Грайворон']);
  });

  it('архивная копия того же дня — одна строка, первая из ответа (самый новый день)', () => {
    const items = normalizeSearch([
      { ...bare, request_id: '10211', status: 'done' },
      { ...bare, request_id: '10211', status: 'planned' },
      { ...bare, request_id: '10211', date: '2026-09-28', status: 'planned' },
    ]);
    expect(items.map((item) => [item.date, item.status])).toEqual([
      ['2026-09-29', 'done'],
      ['2026-09-28', 'planned'],
    ]);
  });
});

describe('normalizeSlots', () => {
  const response: BookingSlotsResponse = {
    region_id: 'east',
    date: '2026-09-30',
    required_skill: 'installation',
    duration_minutes: 70,
    slots: [
      { window: '10:00-12:00', available: false, reason_code: 'NO_CAPACITY', reason: '…' },
      { window: '12:00-14:00', available: true },
    ],
  };

  it('навык — подпись по словарю, окна — как пришли', () => {
    expect(normalizeSlots(response)).toEqual({
      skill: 'Подключение и дозаказ',
      duration: 70,
      slots: [
        { window: '10:00-12:00', available: false },
        { window: '12:00-14:00', available: true },
      ],
    });
  });

  it('⏳ 9.7: район — если бэк вернул', () => {
    const withDistrict = { ...response, district: 'Текстильщики' } as BookingSlotsResponse;
    expect(normalizeSlots(withDistrict).district).toBe('Текстильщики');
  });

  it('нет окон — пустой список', () => {
    const { slots, ...rest } = response;
    expect(slots).toHaveLength(2);
    expect(normalizeSlots(rest).slots).toEqual([]);
  });

  it('isSlotFree', () => {
    const { slots } = normalizeSlots(response);
    expect(isSlotFree(slots, '12:00-14:00')).toBe(true);
    expect(isSlotFree(slots, '10:00-12:00')).toBe(false);
    expect(isSlotFree(slots, '20:00-22:00')).toBe(false);
  });
});

describe('ошибки и ответы мутаций', () => {
  it('⏳ 9.5: окна из details.slots при SLOT_TAKEN', () => {
    expect(
      slotsFromError({ slots: [{ window: '14:00-16:00', available: false, reason: 'x' }] }),
    ).toEqual([{ window: '14:00-16:00', available: false }]);
    expect(slotsFromError(undefined)).toBeNull();
    expect(slotsFromError({ slots: [] })).toBeNull();
  });

  it('⏳ 9.4: message и новые поля — если пришли', () => {
    expect(
      normalizeOutcome({
        status: 'planned',
        message: 'Заявка №1 записана',
        request_id: 305881207,
        window: '14:00-16:00',
      }),
    ).toEqual({
      status: 'planned',
      message: 'Заявка №1 записана',
      requestId: '305881207',
      window: '14:00-16:00',
    });
    expect(normalizeOutcome(undefined)).toEqual({});
    expect(normalizeOutcome({ message: '' })).toEqual({});
    expect(normalizeOutcome({ message: 'Заявка №BK-0001 перенесена на 30.09, 16:00-18:00' }).message).toBe(
      'Заявка №BK-0001 перенесена на 30.09, 16:00–18:00',
    );
  });
});
