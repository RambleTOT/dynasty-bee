import { describe, expect, it } from 'vitest';
import {
  engineerLabel,
  engineerShort,
  HD_BY_BK,
  isEmergency,
  shortId,
  typeFull,
  typeShort,
  typeTitle,
} from './dictionaries';

describe('shortId', () => {
  it('короткий id целиком, длинный — последние 4 цифры', () => {
    expect(shortId('T012')).toBe('T012');
    expect(shortId('U-0001')).toBe('U-0001');
    expect(shortId('305838184')).toBe('…8184');
    expect(shortId('')).toBe('');
  });
});

describe('подписи бригад', () => {
  it('engineerLabel', () => {
    expect(engineerLabel('Бригада Соколов', 'E01')).toBe('Бригада Соколов');
    expect(engineerLabel('', 'E00')).toBe('Бригада E00');
    expect(engineerLabel('E03', 'E03')).toBe('Бригада E03');
    expect(engineerLabel('Капитанчук Александр', 'E07')).toBe('Капитанчук Александр');
  });

  it('engineerShort — без «Бригада», первое слово', () => {
    expect(engineerShort('Бригада Соколов', 'E01')).toBe('Соколов');
    expect(engineerShort('Капитанчук Александр', 'E07')).toBe('Капитанчук');
    expect(engineerShort(null, 'E00')).toBe('E00');
    expect(engineerShort('Бригада 1', 'E01')).toBe('Бригада 1');
  });
});

describe('типы заявки', () => {
  it('typeShort: по BK, без BK — по навыку (§6.8)', () => {
    expect(typeShort('Подключение', 'installation')).toBe('Подкл.');
    expect(typeShort('Локальная заявка', 'local')).toBe('Лок.');
    expect(typeShort('Дозаказ', 'installation')).toBe('Дозак.');
    expect(typeShort('Глобальная проблема', 'emergency')).toBe('Авария');
    expect(typeShort(null, 'emergency')).toBe('Авария');
    expect(typeShort(undefined, 'installation')).toBe('Подкл.');
    expect(typeShort('', 'local')).toBe('Лок.');
  });

  it('typeFull', () => {
    expect(typeFull('Подключение', 'Конвергенция абонента')).toBe(
      'Подключение · Конвергенция абонента',
    );
    expect(typeFull('Подключение', null)).toBe('Подключение');
    expect(typeFull(null, null, 'installation')).toBe('Подключение и дозаказ');
  });

  it('HD по BK, первая строка — самая частая', () => {
    expect(HD_BY_BK['Подключение'][0]).toBe('Конвергенция абонента');
    expect(HD_BY_BK['Глобальная проблема']).toEqual(['Информация']);
  });
});

describe('isEmergency — авария по HD (D-37, ответ №80)', () => {
  it('есть HD — только HD «Авария»', () => {
    expect(isEmergency({ type_bk: 'Глобальная проблема', type_hd: 'Авария', required_skill: 'emergency' })).toBe(true);
    expect(isEmergency({ type_bk: 'Глобальная проблема', type_hd: ' Информация ', required_skill: 'emergency' })).toBe(false);
  });
  it('нет HD, есть BK — BK «Глобальная проблема»', () => {
    expect(isEmergency({ type_bk: 'Глобальная проблема', type_hd: '', required_skill: 'emergency' })).toBe(true);
    expect(isEmergency({ type_bk: 'Подключение', type_hd: null, required_skill: 'emergency' })).toBe(false);
  });
  it('нет ни BK, ни HD (синтетика) — навык «Аварийные работы»', () => {
    expect(isEmergency({ required_skill: 'emergency' })).toBe(true);
    expect(isEmergency({ required_skill: 'local' })).toBe(false);
  });
  it('HD другого типа — не авария, даже с навыком «Аварийные работы»', () => {
    expect(isEmergency({ type_bk: 'Локальная заявка', type_hd: 'Нет линка', required_skill: 'emergency' })).toBe(false);
  });
});

describe('typeShort — «Глобальная проблема» по HD', () => {
  it('«Авария» и «Информ.»; остальные — как раньше', () => {
    expect(typeShort('Глобальная проблема', 'emergency', 'Авария')).toBe('Авария');
    expect(typeShort('Глобальная проблема', 'emergency', 'Информация')).toBe('Информ.');
    expect(typeShort('Глобальная проблема', 'emergency')).toBe('Авария');
    expect(typeShort('Подключение', 'installation', 'Конвергенция абонента')).toBe('Подкл.');
  });
});

describe('typeTitle — тип в карточке неназначенной', () => {
  it('«Глобальная проблема» — «Авария» / «Информация» по HD, остальные — BK', () => {
    expect(typeTitle('Глобальная проблема', 'Информация')).toBe('Информация');
    expect(typeTitle('Глобальная проблема', 'Авария')).toBe('Авария');
    expect(typeTitle('Глобальная проблема', null)).toBe('Авария');
    expect(typeTitle('Подключение', 'Конвергенция абонента')).toBe('Подключение');
    expect(typeTitle(null, null)).toBe('');
  });
});

