import { describe, expect, it } from 'vitest';
import { controlCsv, requestsCsv } from './canonicalCsv';
import type { RequestRow } from './columnMap';
import { toCsvTable } from './csvTable';

const request = (patch: Partial<RequestRow>): RequestRow => ({
  source: 0,
  line: 2,
  id: '1',
  typeBk: 'Ремонт',
  typeHd: '',
  start: '10:00',
  end: '12:00',
  address: 'ул. Первая, 1',
  district: '',
  gigabit: false,
  technology: '',
  transport: null,
  duration: null,
  lat: null,
  lon: null,
  ...patch,
});

describe('requestsCsv', () => {
  const rows = [
    request({ source: 0, id: 'A-1', gigabit: true, transport: 'car' }),
    request({
      source: 1,
      id: 'A-2',
      typeBk: 'Монтаж',
      start: null,
      end: null,
      duration: 90,
      address: 'ул. «Вторая»; корп. 2',
    }),
  ];
  const csv = requestsCsv({
    rows,
    date: '2026-10-01',
    normOf: (typeBk) =>
      typeBk === 'Ремонт'
        ? { skill: 'local', duration: 40 }
        : { skill: 'installation', duration: 70 },
    points: new Map([[0, { lat: 55.1234567, lon: 37.7654321 }]]),
    officeAddress: 'г. Москва; ул. Офисная, 1',
  });

  it('формат Билайна: заголовок, окно с датой, нормативы и точки по строке, адрес офиса в конце', () => {
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение;Подключение;Требуемый транспорт;Навык;Длительность;Широта;Долгота',
    );
    expect(lines[1]).toBe(
      'A-1;Ремонт;;01.10.2026 10:00;01.10.2026 12:00;;ул. Первая, 1;Да;;car;local;40;55.123457;37.765432',
    );
    // длительность из файла важнее норматива; «;» в адресе — в кавычках; окна нет — пусто
    expect(lines[2]).toBe('A-2;Монтаж;;;;;"ул. «Вторая»; корп. 2";Нет;;;installation;90;;');
    expect(lines[3]).toBe('Адрес офиса;г. Москва, ул. Офисная, 1');
  });

  it('читается обратно тем же разбором CSV', () => {
    const table = toCsvTable(csv);
    expect(table.rows[1][6]).toBe('ул. «Вторая»; корп. 2');
    expect(table.officeAddress).toBe('г. Москва, ул. Офисная, 1');
  });
});

describe('controlCsv', () => {
  it('те же строки и порядок, бригада по строке файла заявок', () => {
    const csv = controlCsv({
      rows: [request({ source: 3, id: '7' }), request({ source: 5, id: '8' })],
      date: '2026-10-01',
      brigades: new Map([[5, 'Петров']]),
      officeAddress: 'Офис',
    });
    expect(csv.split('\r\n')).toEqual([
      'Заявка;Тип заявки BK;Начало;Окончание;Адрес;Бригада',
      '7;Ремонт;01.10.2026 10:00;01.10.2026 12:00;ул. Первая, 1;',
      '8;Ремонт;01.10.2026 10:00;01.10.2026 12:00;ул. Первая, 1;Петров',
      'Адрес офиса;Офис',
    ]);
  });
});
