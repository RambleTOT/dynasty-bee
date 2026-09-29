import { describe, expect, it } from 'vitest';
import {
  dateShort,
  dateWithWeekday,
  dayOfMonth,
  defaultHd,
  phoneInput,
  phoneMasked,
  phoneToApi,
  phoneValid,
  requiredTransportByRule,
  transportRuleText,
  typeFull,
  typeShort,
  weekdayShort,
  windowFull,
  windowShort,
} from './booking';

describe('окна', () => {
  it('windowShort: «14–16», минуты — только если не ноль', () => {
    expect(windowShort('14:00-16:00')).toBe('14–16');
    expect(windowShort('10:00-12:00')).toBe('10–12');
    expect(windowShort('09:30-11:30')).toBe('9:30–11:30');
  });

  it('windowFull: «14:00–16:00»', () => {
    expect(windowFull('14:00-16:00')).toBe('14:00–16:00');
    expect(windowFull('9:00-11:00')).toBe('09:00–11:00');
  });

  it('не окно — как есть', () => {
    expect(windowShort('весь день')).toBe('весь день');
    expect(windowFull('')).toBe('');
  });
});

describe('даты', () => {
  it('dateWithWeekday: 29.09.2026 → «Вт, 29.09»', () => {
    expect(dateWithWeekday('2026-09-29')).toBe('Вт, 29.09');
  });

  it('dateShort, день недели и число для ленты', () => {
    expect(dateShort('2026-09-30')).toBe('30.09');
    expect(weekdayShort('2026-09-28')).toBe('Пн');
    expect(dayOfMonth('2026-10-01')).toBe('1');
  });

  it('не дата — без падения', () => {
    expect(dateShort('')).toBe('');
    expect(dateWithWeekday('2026-02-30')).toBe('2026-02-30');
  });
});

describe('тип заявки', () => {
  it('typeShort — одним словом', () => {
    expect(typeShort('Подключение')).toBe('Подключение');
    expect(typeShort('Локальная заявка')).toBe('Локальная');
    expect(typeShort('Глобальная проблема')).toBe('Авария');
    expect(typeShort('Дозаказ')).toBe('Дозаказ');
    expect(typeShort('Новый тип')).toBe('Новый тип');
    expect(typeShort(null)).toBe('');
  });

  it('typeFull: BK · HD; нет HD — только BK', () => {
    expect(typeFull('Подключение', 'Конвергенция абонента')).toBe(
      'Подключение · Конвергенция абонента',
    );
    expect(typeFull('Подключение', null)).toBe('Подключение');
  });

  it('defaultHd — первая строка списка BK', () => {
    expect(defaultHd('Подключение')).toBe('Конвергенция абонента');
    expect(defaultHd('Локальная заявка')).toBe('Нет линка');
    expect(defaultHd('Дозаказ')).toBe('Дозаказ оборудования');
    expect(defaultHd('Глобальная проблема')).toBe('Информация');
    expect(defaultHd('')).toBe('');
    expect(defaultHd('Нет такого')).toBe('');
  });
});

describe('requiredTransportByRule', () => {
  it('кабель → car', () => {
    expect(requiredTransportByRule('Работа с кабелем', false)).toBe('car');
  });

  it('гигабит машину не требует (D-40, п. 55 бэка)', () => {
    expect(requiredTransportByRule('Конвергенция абонента', true)).toBeNull();
    expect(transportRuleText()).toBe('кабель, авария');
  });

  it('авария → car', () => {
    expect(requiredTransportByRule('Авария', false)).toBe('car');
  });

  it('прочее → null', () => {
    expect(requiredTransportByRule('Конвергенция абонента', false)).toBeNull();
    expect(requiredTransportByRule('', false)).toBeNull();
  });
});

describe('телефон', () => {
  it('phoneInput — маска при вводе', () => {
    expect(phoneInput('')).toBe('');
    expect(phoneInput('8')).toBe('+7');
    expect(phoneInput('9')).toBe('+7 (9');
    expect(phoneInput('+7 (916')).toBe('+7 (916');
    expect(phoneInput('+7 (916) 1')).toBe('+7 (916) 1');
    expect(phoneInput('89161234218')).toBe('+7 (916) 123-42-18');
    expect(phoneInput('+7 (916) 123-42-189')).toBe('+7 (916) 123-42-18');
  });

  it('phoneInput — стирание разделителя стирает и хвост', () => {
    expect(phoneInput('+7 (916) ')).toBe('+7 (916');
    expect(phoneInput('+7 (')).toBe('+7');
  });

  it('phoneToApi: «+79161234218»; пусто → undefined', () => {
    expect(phoneToApi('+7 (916) 123-42-18')).toBe('+79161234218');
    expect(phoneToApi('8 916 123 42 18')).toBe('+79161234218');
    expect(phoneToApi('')).toBeUndefined();
    expect(phoneToApi('+7 (916) 12')).toBeUndefined();
  });

  it('phoneValid: пусто или 11 цифр', () => {
    expect(phoneValid('')).toBe(true);
    expect(phoneValid('+7 (916) 123-42-18')).toBe(true);
    expect(phoneValid('+7 (916) 123')).toBe(false);
  });

  it('phoneMasked: «+7 916 ••• 42 18»', () => {
    expect(phoneMasked('+79161234218')).toBe('+7 916 ••• 42 18');
    expect(phoneMasked('+7 (916) 123-42-18')).toBe('+7 916 ••• 42 18');
    expect(phoneMasked('')).toBe('');
    expect(phoneMasked('112')).toBe('112');
  });
});

describe('typeShort оператора — «Глобальная проблема» по HD (D-37)', () => {
  it('«Авария» / «Информация»; «Информация» — обычная запись с HD по умолчанию', () => {
    expect(typeShort('Глобальная проблема', 'Авария')).toBe('Авария');
    expect(typeShort('Глобальная проблема', 'Информация')).toBe('Информация');
    expect(typeShort('Дозаказ', 'Дозаказ оборудования')).toBe('Дозаказ');
    expect(defaultHd('Глобальная проблема')).toBe('Информация');
  });
});

