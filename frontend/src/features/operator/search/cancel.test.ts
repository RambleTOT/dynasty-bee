import { describe, expect, it } from 'vitest';
import { cancelBody, cancelDoneText, cancelReasons } from './cancel';

describe('тело отмены', () => {
  it('«Клиент отказался» и «Ошибка записи» — только причина', () => {
    expect(cancelBody('client_refused', '')).toEqual({ reason: 'client_refused' });
    expect(cancelBody('booking_error', 'не нужен')).toEqual({ reason: 'booking_error' });
  });

  it('«Другое» без комментария не отправляется', () => {
    expect(cancelBody('other', '')).toBeNull();
    expect(cancelBody('other', '   ')).toBeNull();
  });

  it('«Другое» — с текстом без пробелов по краям', () => {
    expect(cancelBody('other', '  Клиент переезжает ')).toEqual({
      reason: 'other',
      comment: 'Клиент переезжает',
    });
  });

  it('«Другое» — только при флаге cancelComment', () => {
    expect(cancelReasons(false)).toEqual(['client_refused', 'booking_error']);
    expect(cancelReasons(true)).toEqual(['client_refused', 'booking_error', 'other']);
  });
});

describe('тост после отмены без message бэка', () => {
  it('дата позже сегодня — «План на DD.MM пересчитан»', () => {
    expect(cancelDoneText('2026-09-30', '2026-09-28')).toBe(
      'Заявка отменена. План на 30.09 пересчитан',
    );
  });

  it('сегодня — окно решит диспетчер', () => {
    expect(cancelDoneText('2026-09-28', '2026-09-28')).toBe(
      'Заявка отменена. Чем занять освободившееся окно, решит диспетчер',
    );
  });
});
