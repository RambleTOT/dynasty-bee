/**
 * Состояние записи O-01 → O-01.2 (FRONTEND_SPEC §8.3.3, §8.3.7, §8.3.8): поля и шаг — в памяти
 * страницы, не в URL; ушли со страницы — форма сброшена. Регион — в useOperatorRegion: его помним.
 */
import { useReducer } from 'react';
import { isSlotFree, type SlotView } from '@/adapters/booking';
import { defaultHd, phoneInput, phoneValid, requiredTransportByRule } from '@/lib/booking';
import type { Transport } from '@/lib/statuses';
import { addDays, todayMsk } from '@/lib/time';

export type Technology = 'FMC' | 'FTTB';
export const TECHNOLOGIES: readonly Technology[] = ['FMC', 'FTTB'];

/** Адрес — обязательно, от 5 символов. */
export const MIN_ADDRESS = 5;

export interface BookingForm {
  step: 1 | 2;
  address: string;
  typeBk: string;
  typeHd: string;
  /** Как в поле, с маской; в запрос — `phoneToApi`. */
  contact: string;
  /** `null` — «Не требуется». */
  transport: Transport | null;
  /** Оператор выбрал транспорт сам — правило больше не трогает поле. */
  transportTouched: boolean;
  gigabit: boolean;
  /** Только для Востока, по умолчанию FMC. */
  technology: Technology;
  /** Дата шага 2, по умолчанию — завтра [Д]. */
  date: string;
  /** Выбранное окно — строка из `slots[]`, '14:00-16:00'. */
  window: string | null;
  /** 409 SLOT_TAKEN: плашка «Это окно только что заняли». */
  slotTaken: boolean;
}

export type BookingFormAction =
  | { type: 'address'; value: string }
  | { type: 'typeBk'; value: string }
  | { type: 'typeHd'; value: string }
  | { type: 'contact'; value: string }
  | { type: 'transport'; value: Transport | null }
  | { type: 'gigabit'; value: boolean }
  | { type: 'technology'; value: Technology }
  | { type: 'step'; value: 1 | 2 }
  | { type: 'date'; value: string }
  | { type: 'window'; value: string }
  /** Пришли свежие окна выбранной даты. */
  | { type: 'slots'; slots: readonly SlotView[] }
  | { type: 'slotTaken' }
  /** Записали — сразу новая запись: пустой шаг 1 (регион хранится отдельно и остаётся). */
  | { type: 'reset'; date: string };

export const tomorrowMsk = () => addDays(todayMsk(), 1);

export function initialBookingForm(date: string = tomorrowMsk()): BookingForm {
  return {
    step: 1,
    address: '',
    typeBk: '',
    typeHd: '',
    contact: '',
    transport: null,
    transportTouched: false,
    gigabit: false,
    technology: 'FMC',
    date,
    window: null,
    slotTaken: false,
  };
}

/** Пока оператор не менял транспорт сам, значение ставит правило D-06 (`requiredTransportByRule`). */
function withTransportRule(form: BookingForm): BookingForm {
  if (form.transportTouched) return form;
  return { ...form, transport: requiredTransportByRule(form.typeHd, form.gigabit) };
}

export function bookingFormReducer(form: BookingForm, action: BookingFormAction): BookingForm {
  switch (action.type) {
    case 'address':
      return { ...form, address: action.value };
    case 'typeBk':
      // смена BK — HD по умолчанию для нового BK
      return withTransportRule({ ...form, typeBk: action.value, typeHd: defaultHd(action.value) });
    case 'typeHd':
      return withTransportRule({ ...form, typeHd: action.value });
    case 'gigabit':
      return withTransportRule({ ...form, gigabit: action.value });
    case 'transport':
      return { ...form, transport: action.value, transportTouched: true };
    case 'contact':
      return { ...form, contact: phoneInput(action.value) };
    case 'technology':
      return { ...form, technology: action.value };
    case 'step':
      return { ...form, step: action.value };
    case 'date':
      if (action.value === form.date) return form;
      return { ...form, date: action.value, window: null, slotTaken: false };
    case 'window':
      return { ...form, window: action.value, slotTaken: false };
    case 'slots':
      // выбранное окно стало занятым (или пропало) — выбор снимаем
      if (!form.window || isSlotFree(action.slots, form.window)) return form;
      return { ...form, window: null };
    case 'slotTaken':
      return { ...form, window: null, slotTaken: true };
    case 'reset':
      return initialBookingForm(action.date);
  }
}

export function useBookingForm() {
  return useReducer(bookingFormReducer, undefined, () => initialBookingForm());
}

/** Подпись «по правилу» у транспорта: автомобиль поставило правило. */
export const transportByRule = (form: BookingForm) =>
  !form.transportTouched && form.transport === 'car';

/**
 * Шаг 1 заполнен: регион, адрес от 5 символов, BK, HD; телефон пустой или полный. У своего участка
 * (§14) — тип из его нормативов (`types`), HD не нужен: подтипов у таких типов нет.
 */
export function stepOneReady(
  form: BookingForm,
  region: string | null,
  types: readonly string[] | null = null,
): boolean {
  const typeReady = types ? types.includes(form.typeBk) : Boolean(form.typeBk) && Boolean(form.typeHd);
  return (
    Boolean(region) &&
    form.address.trim().length >= MIN_ADDRESS &&
    typeReady &&
    phoneValid(form.contact)
  );
}
