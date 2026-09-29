import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlotView } from '@/adapters/booking';
import {
  stepOneReady,
  transportByRule,
  useBookingForm,
  type BookingFormAction,
} from './useBookingForm';

const slots = (...busy: string[]): SlotView[] =>
  ['10:00-12:00', '12:00-14:00', '14:00-16:00'].map((window) => ({
    window,
    available: !busy.includes(window),
  }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function renderForm() {
  const { result } = renderHook(() => useBookingForm());
  return {
    get form() {
      return result.current[0];
    },
    dispatch: (action: BookingFormAction) => act(() => result.current[1](action)),
  };
}

describe('useBookingForm', () => {
  it('старт: шаг 1, дата шага 2 — завтра, транспорт не требуется', () => {
    const { form } = renderForm();
    expect(form).toMatchObject({
      step: 1,
      date: '2026-09-29',
      typeBk: '',
      typeHd: '',
      transport: null,
      technology: 'FMC',
      window: null,
    });
  });

  it('смена BK сбрасывает HD на defaultHd', () => {
    const f = renderForm();
    f.dispatch({ type: 'typeBk', value: 'Подключение' });
    expect(f.form.typeHd).toBe('Конвергенция абонента');
    f.dispatch({ type: 'typeHd', value: 'Заявка на подключение' });
    expect(f.form.typeHd).toBe('Заявка на подключение');
    f.dispatch({ type: 'typeBk', value: 'Локальная заявка' });
    expect(f.form.typeHd).toBe('Нет линка');
  });

  it('транспорт по правилу: кабель → автомобиль «по правилу», гигабит машину не требует (D-40)', () => {
    const f = renderForm();
    f.dispatch({ type: 'typeBk', value: 'Локальная заявка' });
    f.dispatch({ type: 'typeHd', value: 'Работа с кабелем' });
    expect(f.form.transport).toBe('car');
    expect(transportByRule(f.form)).toBe(true);
    f.dispatch({ type: 'typeHd', value: 'Нет линка' });
    expect(f.form.transport).toBeNull();
    f.dispatch({ type: 'gigabit', value: true });
    expect(f.form.transport).toBeNull();
    f.dispatch({ type: 'gigabit', value: false });
    expect(f.form.transport).toBeNull();
  });

  it('ручной выбор транспорта не перезаписывается правилом', () => {
    const f = renderForm();
    f.dispatch({ type: 'typeBk', value: 'Подключение' });
    f.dispatch({ type: 'transport', value: 'public_transport' });
    f.dispatch({ type: 'gigabit', value: true });
    expect(f.form.transport).toBe('public_transport');
    f.dispatch({ type: 'transport', value: 'car' });
    expect(transportByRule(f.form)).toBe(false);
    f.dispatch({ type: 'transport', value: null });
    f.dispatch({ type: 'typeBk', value: 'Локальная заявка' });
    f.dispatch({ type: 'typeHd', value: 'Работа с кабелем' });
    expect(f.form.transport).toBeNull();
  });

  it('окно стало занятым → выбор снят; свободно — остаётся', () => {
    const f = renderForm();
    f.dispatch({ type: 'window', value: '14:00-16:00' });
    f.dispatch({ type: 'slots', slots: slots('10:00-12:00') });
    expect(f.form.window).toBe('14:00-16:00');
    f.dispatch({ type: 'slots', slots: slots('14:00-16:00') });
    expect(f.form.window).toBeNull();
  });

  it('окно пропало из ответа → выбор снят', () => {
    const f = renderForm();
    f.dispatch({ type: 'window', value: '20:00-22:00' });
    f.dispatch({ type: 'slots', slots: slots() });
    expect(f.form.window).toBeNull();
  });

  it('SLOT_TAKEN: выбор снят, плашка; выбор окна убирает плашку', () => {
    const f = renderForm();
    f.dispatch({ type: 'window', value: '14:00-16:00' });
    f.dispatch({ type: 'slotTaken' });
    expect(f.form).toMatchObject({ window: null, slotTaken: true });
    f.dispatch({ type: 'window', value: '12:00-14:00' });
    expect(f.form).toMatchObject({ window: '12:00-14:00', slotTaken: false });
  });

  it('смена даты снимает выбор окна', () => {
    const f = renderForm();
    f.dispatch({ type: 'window', value: '14:00-16:00' });
    f.dispatch({ type: 'date', value: '2026-09-30' });
    expect(f.form).toMatchObject({ date: '2026-09-30', window: null });
  });

  it('после записи — сразу пустой шаг 1 с датой по умолчанию', () => {
    const f = renderForm();
    f.dispatch({ type: 'typeBk', value: 'Дозаказ' });
    f.dispatch({ type: 'address', value: 'ул. Тестовая, д. 1' });
    f.dispatch({ type: 'step', value: 2 });
    f.dispatch({ type: 'window', value: '14:00-16:00' });
    f.dispatch({ type: 'reset', date: '2026-09-29' });
    expect(f.form).toMatchObject({
      step: 1,
      typeBk: '',
      address: '',
      window: null,
      date: '2026-09-29',
    });
  });

  it('телефон — с маской; шаг 1 готов, когда поля заполнены', () => {
    const f = renderForm();
    expect(stepOneReady(f.form, 'east')).toBe(false);
    f.dispatch({ type: 'address', value: 'ул. Т' });
    f.dispatch({ type: 'typeBk', value: 'Подключение' });
    expect(stepOneReady(f.form, 'east')).toBe(true);
    expect(stepOneReady(f.form, null)).toBe(false);
    f.dispatch({ type: 'contact', value: '8916123' });
    expect(f.form.contact).toBe('+7 (916) 123');
    expect(stepOneReady(f.form, 'east')).toBe(false);
    f.dispatch({ type: 'contact', value: '+7 (916) 123-42-18' });
    expect(stepOneReady(f.form, 'east')).toBe(true);
    f.dispatch({ type: 'address', value: 'ул.' });
    expect(stepOneReady(f.form, 'east')).toBe(false);
  });

  it('свой участок (§14): тип — из нормативов участка, HD не нужен', () => {
    const f = renderForm();
    f.dispatch({ type: 'address', value: 'Химки, ул. Кирова, 24' });
    f.dispatch({ type: 'typeBk', value: 'Ремонт ТВ' });
    expect(f.form.typeHd).toBe('');
    expect(stepOneReady(f.form, 'east')).toBe(false);
    expect(stepOneReady(f.form, 'r-himki', ['Ремонт ТВ'])).toBe(true);
    expect(stepOneReady(f.form, 'r-himki', ['Подключение'])).toBe(false);
  });
});
