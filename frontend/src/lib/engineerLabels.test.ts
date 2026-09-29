import { describe, expect, it } from 'vitest';
import {
  fullAddress,
  requestNo,
  requestNoShort,
  shiftEndWarning,
  shortAddress,
  visitTitle,
  windowFull,
  windowShort,
} from './engineerLabels';

describe('visitTitle', () => {
  it('type_hd важнее type_bk', () => {
    expect(visitTitle({ type_hd: 'Разрывы', type_bk: 'Локальная заявка' })).toBe('Разрывы');
  });

  it('нет HD — BK', () => {
    expect(visitTitle({ type_hd: null, type_bk: 'Подключение' })).toBe('Подключение');
    expect(visitTitle({ type_hd: '  ', type_bk: 'Подключение' })).toBe('Подключение');
  });

  it('нет HD и BK — подпись по навыку (синтетика)', () => {
    expect(visitTitle({ required_skill: 'emergency' })).toBe('Авария');
    expect(visitTitle({ required_skill: 'installation' })).toBe('Подключение и дозаказ');
    expect(visitTitle({ required_skill: 'local' })).toBe('Локальные работы');
  });

  it('совсем пусто — «Заявка»', () => {
    expect(visitTitle({})).toBe('Заявка');
  });
});

describe('номер заявки', () => {
  it('в карточке — полностью, в строке — коротко', () => {
    expect(requestNo('305871402')).toBe('№305871402');
    expect(requestNoShort('305871402')).toBe('№…1402');
    expect(requestNoShort('T012')).toBe('№T012');
  });
});

describe('адрес', () => {
  it('в строке — без «Город Москва, » и квартиры', () => {
    expect(shortAddress('Город Москва, ул.Окская, д. 48/2, кв. 13')).toBe('ул.Окская, д. 48/2');
    expect(shortAddress('г. Москва, ул. Артюхиной, д. 3 кв.107')).toBe('ул. Артюхиной, д. 3');
    expect(shortAddress('Город Москва, ул.Грайвороновская, д. 10 к 2')).toBe(
      'ул.Грайвороновская, д. 10 к 2',
    );
  });

  it('другой город остаётся', () => {
    expect(shortAddress('Домодедово, ул.Зеленая, д. 85')).toBe('Домодедово, ул.Зеленая, д. 85');
  });

  it('в карточке — квартира остаётся', () => {
    expect(fullAddress('Город Москва, ул.Окская, д. 48/2, кв. 13')).toBe(
      'ул.Окская, д. 48/2, кв. 13',
    );
  });

  it('пусто — пустая строка', () => {
    expect(shortAddress(null)).toBe('');
    expect(fullAddress(undefined)).toBe('');
  });
});

describe('окно', () => {
  it('в строке «14–16», в карточке «14:00–16:00»', () => {
    expect(windowShort('14:00-16:00')).toBe('14–16');
    expect(windowFull('14:00-16:00')).toBe('14:00–16:00');
  });

  it('минуты и часы до 10 — без нуля впереди', () => {
    expect(windowShort('09:30-11:00')).toBe('9:30–11');
    expect(windowFull('9:30-11:00')).toBe('09:30–11:00');
  });

  it('не окно — как пришло', () => {
    expect(windowShort('весь день')).toBe('весь день');
    expect(windowFull(null)).toBe('');
  });
});

describe('подтверждение «Завершить смену»', () => {
  it('число и глагол согласованы', () => {
    expect(shiftEndWarning(1)).toBe('Осталась 1 заявка. Она вернётся диспетчеру');
    expect(shiftEndWarning(3)).toBe('Осталось 3 заявки. Они вернутся диспетчеру');
    expect(shiftEndWarning(5)).toBe('Осталось 5 заявок. Они вернутся диспетчеру');
    expect(shiftEndWarning(11)).toBe('Осталось 11 заявок. Они вернутся диспетчеру');
  });
});
