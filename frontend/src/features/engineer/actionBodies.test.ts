import { describe, expect, it } from 'vitest';
import { failPayload, incidentPayload, quarterHours, unavailablePayload } from './actionBodies';

const dates = { minDate: '2026-09-30', maxDate: '2026-10-13' };

describe('failPayload — «Прервать выполнение» (E-06)', () => {
  it('клиент отказался, нет доступа', () => {
    expect(failPayload('client_refused', { ...dates, desiredDate: '', comment: '' })).toEqual({
      payload: { reason: 'client_refused' },
    });
    expect(failPayload('no_access', { ...dates, desiredDate: '', comment: '' })).toEqual({
      payload: { reason: 'no_access' },
    });
  });

  it('перенос — желаемая дата обязательна, с завтра до +14 дней', () => {
    expect(failPayload('client_reschedule', { ...dates, desiredDate: '', comment: '' })).toEqual({
      field: 'desiredDate',
      error: 'Укажите желаемую дату',
    });
    expect(
      failPayload('client_reschedule', { ...dates, desiredDate: '2026-09-29', comment: '' }),
    ).toEqual({ field: 'desiredDate', error: 'Дата — с 30.09 по 13.10' });
    expect(
      failPayload('client_reschedule', { ...dates, desiredDate: '2026-10-14', comment: '' }),
    ).toMatchObject({ field: 'desiredDate' });
    expect(
      failPayload('client_reschedule', { ...dates, desiredDate: '2026-10-13', comment: '' }),
    ).toEqual({ payload: { reason: 'client_reschedule', desired_date: '2026-10-13' } });
  });

  it('«Другое» — текст обязателен, пробелы по краям убираем', () => {
    expect(failPayload('other', { ...dates, desiredDate: '', comment: '   ' })).toEqual({
      field: 'comment',
      error: 'Обязательное поле',
    });
    expect(failPayload('other', { ...dates, desiredDate: '', comment: ' Нет ключей ' })).toEqual({
      payload: { reason: 'other', comment: 'Нет ключей' },
    });
  });
});

describe('incidentPayload — «Инцидент» (E-07 ⏳)', () => {
  it('сломался транспорт — с новым транспортом', () => {
    expect(
      incidentPayload('transport_broken', { newTransport: 'public_transport', comment: '' }),
    ).toEqual({ payload: { reason: 'transport_broken', new_transport: 'public_transport' } });
    expect(incidentPayload('transport_broken', { newTransport: null, comment: '' })).toMatchObject({
      field: 'newTransport',
    });
  });

  it('не могу продолжить; «Другое» — с текстом', () => {
    expect(incidentPayload('cannot_continue', { newTransport: null, comment: '' })).toEqual({
      payload: { reason: 'cannot_continue' },
    });
    expect(incidentPayload('other', { newTransport: null, comment: '' })).toMatchObject({
      field: 'comment',
    });
    expect(incidentPayload('other', { newTransport: null, comment: 'Пробка' })).toEqual({
      payload: { reason: 'other', comment: 'Пробка' },
    });
  });
});

describe('unavailablePayload — «Не могу работать» (E-08)', () => {
  it('с какого времени и причина; «Без причины» — без reason', () => {
    expect(unavailablePayload('now', 'sick')).toEqual({ from: 'now', reason: 'sick' });
    expect(unavailablePayload('15:30', 'family')).toEqual({ from: '15:30', reason: 'family' });
    expect(unavailablePayload('now', 'none')).toEqual({ from: 'now' });
  });

  it('время шагом 15 мин после «сейчас» и до конца смены', () => {
    expect(quarterHours('14:32', '16:00')).toEqual(['14:45', '15:00', '15:15', '15:30', '15:45']);
    expect(quarterHours('14:45', '15:30')).toEqual(['15:00', '15:15']);
    expect(quarterHours('21:50', '22:00')).toEqual([]);
    expect(quarterHours('23:20', null)).toEqual(['23:30', '23:45']);
  });
});
