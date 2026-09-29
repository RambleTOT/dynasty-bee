import { describe, expect, it } from 'vitest';
import { bookedText, bookingRequestBody } from './bookingRequest';
import { initialBookingForm, type BookingForm } from './useBookingForm';

const form: BookingForm & { window: string } = {
  ...initialBookingForm('2026-09-30'),
  step: 2,
  address: '  ул. Тестовая, д. 1, кв. 2 ',
  typeBk: 'Подключение',
  typeHd: 'Конвергенция абонента',
  contact: '+7 (916) 123-42-18',
  transport: 'car',
  gigabit: true,
  technology: 'FTTB',
  window: '14:00-16:00',
};

describe('тело записи', () => {
  it('Восток: технология, телефон для API, окно как в slots', () => {
    expect(bookingRequestBody(form, 'east', 'Текстильщики')).toEqual({
      region_id: 'east',
      date: '2026-09-30',
      window: '14:00-16:00',
      type_bk: 'Подключение',
      type_hd: 'Конвергенция абонента',
      address: 'ул. Тестовая, д. 1, кв. 2',
      district: 'Текстильщики',
      gigabit: true,
      technology: 'FTTB',
      required_transport: 'car',
      client_contact: '+79161234218',
    });
  });

  it('другие регионы — technology null; «Не требуется» — null; без телефона и района', () => {
    const body = bookingRequestBody(
      { ...form, contact: '', transport: null },
      'south_center',
      undefined,
    );
    expect(body.technology).toBeNull();
    expect(body.required_transport).toBeNull();
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('client_contact');
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('district');
  });
});

describe('тост после записи', () => {
  const body = bookingRequestBody(form, 'east');

  it('planned — «План дня пересчитан»', () => {
    expect(bookedText({ status: 'planned', requestId: '305881207' }, body)).toBe(
      'Заявка №305881207 записана на 30.09, 14–16. План дня пересчитан',
    );
  });

  it('unassigned — бригаду не поставить, назначит диспетчер (текст бэка звучит как успех — свой)', () => {
    const text = 'Заявка №1 записана на 30.09, 14–16, но бригаду в это окно не поставить — назначит диспетчер';
    expect(bookedText({ status: 'unassigned', requestId: '1' }, body)).toBe(text);
    expect(
      bookedText({ status: 'unassigned', requestId: '1', message: 'Инженера назначит диспетчер' }, body),
    ).toBe(text);
  });

  it('202 recalculating — «План дня пересчитывается»', () => {
    expect(bookedText({ status: 'recalculating' }, body)).toBe(
      'Заявка записана на 30.09, 14–16. План дня пересчитывается',
    );
  });

  it('message бэка важнее', () => {
    expect(bookedText({ status: 'planned', message: 'Записано' }, body)).toBe('Записано');
  });
});
