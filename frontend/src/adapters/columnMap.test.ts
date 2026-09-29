import { describe, expect, it } from 'vitest';
import {
  CONTROL_FIELDS,
  groupNotes,
  guessMapping,
  parseBoolCell,
  parseClock,
  parseDurationCell,
  parseSkillsCell,
  parseTransportCell,
  parseWindowCell,
  readControl,
  readRequests,
  REQUEST_FIELDS,
  requestMappingErrors,
  ROSTER_FIELDS,
  type Mapping,
  type RequestField,
} from './columnMap';
import { toCsvTable } from './csvTable';

const BEELINE_HEADER = [
  'Заявка',
  'Тип заявки BK',
  'Тип заявки HD',
  'Начало',
  'Окончание',
  'Район',
  'Адрес',
  'Гигабитное подключение',
];

describe('guessMapping', () => {
  it('заголовок Билайна — все поля на месте', () => {
    const mapping = guessMapping(REQUEST_FIELDS, BEELINE_HEADER);
    expect(mapping).toMatchObject({
      id: 0,
      typeBk: 1,
      typeHd: 2,
      start: 3,
      end: 4,
      district: 5,
      address: 6,
      gigabit: 7,
      window: null,
      lat: null,
    });
    expect(requestMappingErrors(mapping, BEELINE_HEADER)).toEqual([]);
  });

  it('чужие названия: «№ заявки», «Вид работ», «Адрес клиента (полный)», «Интервал», lat/lon', () => {
    const header = ['№ заявки', 'Вид работ', 'Адрес клиента (полный)', 'Интервал', 'lat', 'lon'];
    const mapping = guessMapping(REQUEST_FIELDS, header);
    expect(mapping).toMatchObject({ id: 0, typeBk: 1, address: 2, window: 3, lat: 4, lon: 5 });
    expect(requestMappingErrors(mapping, header)).toEqual([]);
  });

  it('без окна и адреса — ошибки; колонка дважды — ошибка', () => {
    const header = ['Тип', 'Что-то'];
    const mapping = guessMapping(REQUEST_FIELDS, header);
    const errors = requestMappingErrors({ ...mapping, district: 0 }, header);
    expect(errors).toContain('Выберите колонку «Адрес»');
    expect(errors).toContain('Выберите «Начало окна» и «Конец окна» или «Окно одной колонкой»');
    expect(errors).toContain('Колонка «Тип» выбрана дважды: «Тип заявки», «Район»');
  });

  it('контрольный файл и бригады', () => {
    expect(guessMapping(CONTROL_FIELDS, ['Заявка', 'Статус BK', 'Бригада'])).toEqual({
      id: 0,
      brigade: 2,
    });
    expect(
      guessMapping(ROSTER_FIELDS, ['ФИО', 'Навыки', 'Транспорт', 'Начало смены', 'Конец смены']),
    ).toEqual({ name: 0, skills: 1, transport: 2, shiftStart: 3, shiftEnd: 4 });
  });
});

describe('ячейки', () => {
  it('время', () => {
    expect(parseClock('17.08.2026 18:00')).toBe('18:00');
    expect(parseClock('2026-08-17T09:30:00')).toBe('09:30');
    expect(parseClock('9')).toBe('09:00');
    expect(parseClock('10.30')).toBe('10:30');
    expect(parseClock('24:00')).toBe('23:59');
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('17.08.2026')).toBeNull();
    expect(parseClock('')).toBeNull();
  });

  it('окно одной ячейкой', () => {
    expect(parseWindowCell('10:00-12:00')).toEqual({ start: '10:00', end: '12:00' });
    expect(parseWindowCell('с 10 до 12')).toEqual({ start: '10:00', end: '12:00' });
    expect(parseWindowCell('14–16')).toEqual({ start: '14:00', end: '16:00' });
    expect(parseWindowCell('17.08.2026 10:00 – 17.08.2026 12:00')).toEqual({
      start: '10:00',
      end: '12:00',
    });
    expect(parseWindowCell('утро')).toBeNull();
  });

  it('да/нет, длительность, транспорт, навыки', () => {
    expect(parseBoolCell('Да')).toBe(true);
    expect(parseBoolCell('нет')).toBe(false);
    expect(parseBoolCell('может быть')).toBeNull();
    expect(parseDurationCell('70')).toBe(70);
    expect(parseDurationCell('1:10')).toBe(70);
    expect(parseDurationCell('1 ч 10 мин')).toBe(70);
    expect(parseDurationCell('1,5 ч')).toBe(90);
    expect(parseDurationCell('2')).toBeNull();
    expect(parseTransportCell('Автомобиль')).toBe('car');
    expect(parseTransportCell('public_transport')).toBe('public_transport');
    expect(parseTransportCell('самокат')).toBeNull();
    expect(parseSkillsCell('Работы на подключение и дозаказы; Аварийные работы')).toEqual([
      'installation',
      'emergency',
    ]);
    expect(parseSkillsCell('local')).toEqual(['local']);
  });
});

describe('readRequests', () => {
  const table = toCsvTable(
    [
      'Номер;Вид работ;Окно;Адрес;Длительность;Широта;Долгота;Транспорт',
      '1;Подключение;10-12;ул. Первая, 1;;55,75;37,61;',
      '2;Ремонт;вечером;ул. Вторая, 2;90;;;пешком',
      '3;Ремонт;12-14;;;;;',
      '1;Ремонт;14–16;ул. Третья, 3;abc;91;;ракета',
    ].join('\n'),
  );
  const mapping = guessMapping(REQUEST_FIELDS, table.header) as Mapping<RequestField>;

  it('строки, пропуски и оговорки', () => {
    const { rows, skipped, notes } = readRequests(table, mapping);
    expect(rows.map((row) => row.id)).toEqual(['1', '2', '1-2']);
    expect(rows[0]).toMatchObject({ start: '10:00', end: '12:00', lat: 55.75, lon: 37.61 });
    expect(rows[1]).toMatchObject({ start: null, end: null, duration: 90, transport: 'walk' });
    expect(rows[2]).toMatchObject({
      source: 3,
      line: 5,
      lat: null,
      duration: null,
      transport: null,
    });
    expect(skipped).toEqual([{ line: 4, text: 'нет адреса' }]);
    expect(groupNotes(notes)).toEqual([
      { text: 'окно не распознано — весь день смены', lines: [3] },
      { text: 'номер 1 повторяется — загрузим как 1-2', lines: [5] },
      { text: 'координаты не распознаны — найдём по адресу', lines: [5] },
      { text: 'длительность не распознана — по нормативу участка', lines: [5] },
      { text: 'транспорт не распознан — по правилу (кабель, гигабит, авария)', lines: [5] },
    ]);
  });
});

describe('readControl', () => {
  const requestsTable = toCsvTable(
    ['Заявка;Тип;Начало;Конец;Адрес', '11;A;10;12;x', '12;A;10;12;y', '13;A;10;12;z'].join('\n'),
  );
  const requests = readRequests(
    requestsTable,
    guessMapping(REQUEST_FIELDS, requestsTable.header),
  ).rows;

  it('по номеру заявки, если номера совпадают', () => {
    const control = toCsvTable(['Заявка;Бригада', '13;Петров', '11;Иванов'].join('\n'));
    const read = readControl(
      control,
      guessMapping(CONTROL_FIELDS, control.header),
      requestsTable,
      requests,
    );
    expect(read).toMatchObject({ by: 'id', matched: 2 });
    expect(typeof read !== 'string' && [...read.brigades]).toEqual([
      [0, 'Иванов'],
      [2, 'Петров'],
    ]);
  });

  it('номера другие (как в файлах кейса) — по порядку строк', () => {
    const control = toCsvTable(['Заявка;Бригада', '901;Иванов', '902;', '903;Петров'].join('\n'));
    const read = readControl(
      control,
      guessMapping(CONTROL_FIELDS, control.header),
      requestsTable,
      requests,
    );
    expect(read).toMatchObject({ by: 'order', matched: 2 });
  });

  it('номера другие и строк не поровну — ошибка', () => {
    const control = toCsvTable(['Заявка;Бригада', '901;Иванов'].join('\n'));
    const read = readControl(
      control,
      guessMapping(CONTROL_FIELDS, control.header),
      requestsTable,
      requests,
    );
    expect(read).toMatch(/В контрольном файле 1 строк/);
  });
});
