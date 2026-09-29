import { describe, expect, it } from 'vitest';
import { guessSkill, normError, normLookup, normRows, toRegionNorms } from './regionNorms';

const rows = (...types: string[]) => types.map((typeBk) => ({ typeBk }));

describe('normRows', () => {
  it('частые типы выше; Билайн, участок, угадали по названию', () => {
    const result = normRows(
      rows('Ремонт ТВ', 'Подключение', 'Подключение', 'Монтаж камер', 'Ремонт ТВ', 'Подключение'),
      { types: [{ type_bk: 'ремонт тв', skill: 'local', duration_minutes: 45 }] },
    );
    expect(result).toEqual([
      { typeBk: 'Подключение', count: 3, skill: 'installation', duration: 70, source: 'beeline' },
      { typeBk: 'Ремонт ТВ', count: 2, skill: 'local', duration: 45, source: 'saved' },
      { typeBk: 'Монтаж камер', count: 1, skill: 'installation', duration: 70, source: 'guess' },
    ]);
  });

  it('навык по названию', () => {
    expect(guessSkill('Авария на линии')).toBe('emergency');
    expect(guessSkill('Дозаказ оборудования')).toBe('installation');
    expect(guessSkill('Замена роутера')).toBe('local');
  });
});

describe('нормативы для бэка', () => {
  it('ошибки минут, поиск по типу без регистра, пустой тип не сохраняем', () => {
    const base = { count: 1, skill: 'local' as const, source: 'guess' as const };
    expect(normError({ ...base, typeBk: 'A', duration: null })).toBe('Укажите минуты');
    expect(normError({ ...base, typeBk: 'A', duration: 2 })).toBe('От 5 до 480 минут');
    expect(normError({ ...base, typeBk: 'A', duration: 30 })).toBeNull();
    const norms = [
      { ...base, typeBk: 'Ремонт', duration: 40 },
      { ...base, typeBk: '', duration: 30 },
      { ...base, typeBk: 'Пусто', duration: null },
    ];
    expect(normLookup(norms)('  РЕМОНТ ')).toEqual({ skill: 'local', duration: 40 });
    expect(normLookup(norms)('')).toEqual({ skill: 'local', duration: 30 });
    expect(toRegionNorms(norms)).toEqual({
      types: [{ type_bk: 'Ремонт', skill: 'local', duration_minutes: 40 }],
    });
  });
});
