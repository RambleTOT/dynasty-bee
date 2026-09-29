import { describe, expect, it } from 'vitest';
import { guessMapping, ROSTER_FIELDS, type RequestRow } from './columnMap';
import { toCsvTable } from './csvTable';
import {
  checkRoster,
  engineersCsv,
  rosterByRule,
  rosterFromControl,
  rosterFromFile,
  rosterFromSaved,
  shiftOf,
  toRosterEngineers,
  withIds,
} from './regionRoster';

const row = (source: number, typeBk: string, start: string | null, end: string | null) =>
  ({ source, typeBk, start, end }) as RequestRow;

describe('смена и правило', () => {
  it('смена — по окнам, окно «на весь день» не считается; окон нет — смена кейса', () => {
    expect(
      shiftOf([
        row(0, 'A', '12:00', '14:00'),
        row(1, 'A', '09:00', '11:00'),
        row(2, 'A', '00:01', '23:59'),
      ]),
    ).toEqual({
      start: '09:00',
      end: '14:00',
    });
    expect(shiftOf([row(0, 'A', null, null)])).toEqual({ start: '10:00', end: '22:00' });
  });

  it('правило: бригада на 5–6 заявок, не меньше трёх, авария у каждой 4-й', () => {
    const shift = { start: '09:00', end: '18:00' };
    expect(rosterByRule(4, shift)).toHaveLength(3);
    const rule = rosterByRule(40, shift);
    expect(rule).toHaveLength(8);
    expect(rule.filter((item) => item.skills.includes('emergency'))).toHaveLength(2);
    expect(rule[1]).toMatchObject({ name: 'Бригада 2', transport: 'car', shiftStart: '09:00' });
  });
});

describe('источники состава', () => {
  const shift = { start: '10:00', end: '20:00' };

  it('контрольный файл: имена по порядку, навыки — по заявкам бригады', () => {
    const requests = [
      row(0, 'Подключение', null, null),
      row(1, 'Авария', null, null),
      row(2, 'Ремонт', null, null),
    ];
    const brigades = new Map([
      [0, 'Иванов'],
      [1, 'Петров'],
      [2, 'Иванов'],
    ]);
    const skillOf = (item: RequestRow) =>
      item.typeBk === 'Подключение'
        ? 'installation'
        : item.typeBk === 'Авария'
          ? 'emergency'
          : 'local';
    const roster = rosterFromControl(requests, brigades, skillOf, shift);
    expect(roster.map((item) => [item.name, item.skills])).toEqual([
      ['Иванов', ['local', 'installation']],
      ['Петров', ['emergency']],
    ]);
  });

  it('файл бригад: навыки, транспорт, смена; повторы и пустые имена пропускаем', () => {
    const table = toCsvTable(
      [
        'ФИО;Навыки;Транспорт;Начало смены;Конец смены',
        'Иванов;Подключение, авария;пешком;09:00;18:00',
        ';local;car;;',
        'Иванов;local;car;;',
        'Петров;;;;',
      ].join('\n'),
    );
    const roster = rosterFromFile(table, guessMapping(ROSTER_FIELDS, table.header), shift);
    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({
      name: 'Иванов',
      skills: ['installation', 'emergency'],
      transport: 'walk',
      shiftStart: '09:00',
      shiftEnd: '18:00',
    });
    expect(roster[1]).toMatchObject({
      name: 'Петров',
      skills: [],
      transport: 'car',
      shiftStart: '10:00',
    });
  });

  it('сохранённые бригады участка — с их id', () => {
    const roster = rosterFromSaved([
      {
        id: 'E07',
        name: 'Сидоров',
        latitude: 55,
        longitude: 37,
        shift_start: '08:00:00',
        shift_end: '17:00',
        skills: ['local', 'unknown'],
        transport: 'bike',
      },
    ]);
    expect(roster[0]).toMatchObject({
      id: 'E07',
      skills: ['local'],
      transport: 'bike',
      shiftStart: '08:00',
    });
  });
});

describe('проверка и выгрузка', () => {
  const shift = { start: '10:00', end: '20:00' };

  it('ошибки и нехватка навыка', () => {
    const [a, b] = rosterByRule(2, shift);
    const check = checkRoster(
      [
        { ...a, name: 'Бригада', skills: ['local'] },
        { ...b, name: 'Бригада', skills: [], shiftStart: '20:00', shiftEnd: '10:00' },
      ],
      new Map([
        ['local', 3],
        ['emergency', 2],
      ]),
    );
    expect(check.errors).toEqual([
      'Имена повторяются: Бригада',
      'У каждой бригады — хотя бы один навык',
      'Смена: начало раньше конца',
    ]);
    expect(check.warnings).toEqual([
      'Ни у одной бригады нет навыка «Аварийные работы»: 2 заявки не назначатся',
    ]);
    expect(checkRoster([], new Map()).errors).toEqual(['Добавьте хотя бы одну бригаду']);
  });

  it('id: свои сохраняем, новым — E01… без повторов; ростер и engineers_file для бэка', () => {
    const [a, b, c] = rosterByRule(10, shift);
    const rows = withIds([a, { ...b, id: 'E01' }, { ...c, name: 'Бригада "Север", 3' }]);
    expect(rows.map((item) => item.id)).toEqual(['E02', 'E01', 'E03']);
    const engineers = toRosterEngineers(rows, { lat: 55.7, lon: 37.6 });
    expect(engineers[0]).toEqual({
      id: 'E02',
      name: 'Бригада 1',
      latitude: 55.7,
      longitude: 37.6,
      shift_start: '10:00',
      shift_end: '20:00',
      skills: ['local', 'installation', 'emergency'],
      transport: 'car',
      available: true,
    });
    expect(engineersCsv(engineers).split('\n')).toEqual([
      'id,name,latitude,longitude,shift_start,shift_end,skills,transport,available',
      'E02,Бригада 1,55.7,37.6,10:00,20:00,local;installation;emergency,car,true',
      'E01,Бригада 2,55.7,37.6,10:00,20:00,local;installation,car,true',
      'E03,"Бригада ""Север"", 3",55.7,37.6,10:00,20:00,local;installation,car,true',
    ]);
  });
});
