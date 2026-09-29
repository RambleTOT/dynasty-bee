import { describe, expect, it } from 'vitest';
import { readCsvTable, toCsvTable } from './csvTable';

describe('toCsvTable', () => {
  it('выгрузка Билайна: заголовок, строки, пустые хвосты и адрес офиса', () => {
    const table = toCsvTable(
      [
        'Заявка;Тип заявки BK;Начало;Окончание;Адрес;;',
        '1;Подключение;01.10.2026 10:00;01.10.2026 12:00;ул. Первая, д. 1;;',
        ';;;;;;',
        '2;Дозаказ;01.10.2026 12:00;01.10.2026 14:00;ул. Вторая, д. 2;;',
        'Адрес офиса;г. Москва, ул. Офисная, д. 1;;;;;',
      ].join('\r\n'),
      'windows-1251',
    );
    expect(table.header).toEqual(['Заявка', 'Тип заявки BK', 'Начало', 'Окончание', 'Адрес']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]).toEqual([
      '2',
      'Дозаказ',
      '01.10.2026 12:00',
      '01.10.2026 14:00',
      'ул. Вторая, д. 2',
    ]);
    expect(table.lines).toEqual([2, 4]);
    expect(table.officeAddress).toBe('г. Москва, ул. Офисная, д. 1');
    expect(table.encoding).toBe('windows-1251');
    expect(table.delimiter).toBe(';');
  });

  it('запятая и кавычки; адрес офиса через двоеточие', () => {
    const table = toCsvTable(
      [
        'ID,Адрес клиента,Окно',
        '7,"Москва, Тверская, 7",10-12',
        'Адрес офиса: Химки, Молодёжная, 4',
      ].join('\n'),
    );
    expect(table.delimiter).toBe(',');
    expect(table.rows).toEqual([['7', 'Москва, Тверская, 7', '10-12']]);
    expect(table.officeAddress).toBe('Химки, Молодёжная, 4');
  });

  it('табуляция; короткая строка дополняется пустыми ячейками', () => {
    const table = toCsvTable('Номер\tАдрес\tТип\n5\tул. Пятая');
    expect(table.delimiter).toBe('\t');
    expect(table.rows).toEqual([['5', 'ул. Пятая', '']]);
  });

  it('пустой файл — без заголовка и строк', () => {
    expect(toCsvTable('\n;;;\n')).toMatchObject({ header: [], rows: [], officeAddress: null });
  });

  it('файл: UTF-8 с BOM', async () => {
    const file = new File(['﻿Заявка;Адрес\n1;ул. Первая'], 'r.csv');
    const table = await readCsvTable(file);
    expect(table.encoding).toBe('utf-8');
    expect(table.header).toEqual(['Заявка', 'Адрес']);
  });
});
