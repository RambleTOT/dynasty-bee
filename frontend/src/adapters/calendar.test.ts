import { describe, expect, it } from 'vitest';
import type { CalendarResponse } from '@/api/types';
import {
  buildCalendarMonth,
  calendarRange,
  calendarSummary,
  summaryRegionCount,
  type CalendarCell,
} from './calendar';

// Форма ответа — как у бэка: дни без заявок не приходят, во flags пока только urgent.
const RESPONSE: CalendarResponse = {
  days: [
    {
      date: '2026-09-29',
      request_count: 66,
      by_status: {
        done: 14,
        en_route: 2,
        in_progress: 4,
        planned: 42,
        cancel_pending: 1,
        unassigned: 3,
      },
      flags: { urgent: 2, late: 1 },
      sources: ['csv'],
    },
    {
      date: '2026-09-10',
      request_count: 20,
      by_status: { done: 18, cancelled: 2 },
      flags: { urgent: 0 },
      sources: ['booking'],
    },
    {
      date: '2026-09-15',
      request_count: 7,
      by_status: { planned: 5, cancelled: 1, rescheduled: 1 },
      flags: { late: 0 },
      sources: ['demo'],
    },
    // день соседнего месяца: в сетке есть, в итог месяца и легенду не входит
    {
      date: '2026-10-02',
      request_count: 4,
      by_status: { reschedule_pending: 4 },
      flags: {},
      sources: ['booking'],
    },
  ],
};

const TODAY = '2026-09-29';

function cellAt(cells: CalendarCell[], date: string): CalendarCell {
  const cell = cells.find((item) => item.date === date);
  if (!cell) throw new Error(`нет ячейки ${date}`);
  return cell;
}

describe('calendarRange / сетка', () => {
  it('целые недели с понедельника, включая дни соседних месяцев', () => {
    expect(calendarRange('2026-09')).toEqual({ from: '2026-08-31', to: '2026-10-04' });
    const model = buildCalendarMonth('2026-09', RESPONSE, TODAY);
    expect(model.cells).toHaveLength(35);
    expect(model.cells[0]).toMatchObject({
      date: '2026-08-31',
      day: 31,
      weekday: 1,
      inMonth: false,
    });
    expect(model.cells[34]).toMatchObject({
      date: '2026-10-04',
      day: 4,
      weekday: 7,
      inMonth: false,
    });
  });
});

describe('buildCalendarMonth', () => {
  const model = buildCalendarMonth('2026-09', RESPONSE, TODAY);

  it('полоса — по статусам ТЗ в порядке CALENDAR_BAR_STATUSES', () => {
    const cell = cellAt(model.cells, '2026-09-29');
    expect(cell.segments).toEqual([
      { status: 'done', count: 14, tone: 'success' },
      { status: 'in_progress', count: 4, tone: 'info' },
      { status: 'en_route', count: 2, tone: 'info' },
      { status: 'planned', count: 42, tone: 'neutral' },
      { status: 'cancel_pending', count: 1, tone: 'warning' },
      { status: 'unassigned', count: 3, tone: 'danger' },
    ]);
  });

  it('ячейка: «N заявок», CSV, сегодня, «не назначены», «просрочена»', () => {
    expect(cellAt(model.cells, '2026-09-29')).toMatchObject({
      countLabel: '66 заявок',
      csv: true,
      isToday: true,
      isPast: false,
      inMonth: true,
      unassignedLabel: '3 не назначены',
      lateLabel: '1 просрочена',
    });
  });

  it('отменённые и перенесённые в полосу не входят; demo — тоже бейдж CSV; booking — нет', () => {
    const past = cellAt(model.cells, '2026-09-10');
    expect(past.segments).toEqual([{ status: 'done', count: 18, tone: 'success' }]);
    expect(past).toMatchObject({
      countLabel: '20 заявок',
      csv: false,
      isPast: true,
      isToday: false,
    });
    const demo = cellAt(model.cells, '2026-09-15');
    expect(demo.segments.map((segment) => segment.status)).toEqual(['planned']);
    expect(demo.csv).toBe(true);
  });

  it('«просрочена» — только если flags.late пришёл и больше нуля', () => {
    expect(cellAt(model.cells, '2026-09-10').lateLabel).toBeNull();
    expect(cellAt(model.cells, '2026-09-15').lateLabel).toBeNull();
  });

  it('день без заявок — «—», без подсказки', () => {
    expect(cellAt(model.cells, '2026-09-01')).toMatchObject({
      countLabel: '—',
      count: 0,
      segments: [],
      tip: null,
      unassignedLabel: null,
      lateLabel: null,
    });
  });

  it('день соседнего месяца приглушён, но с данными', () => {
    expect(cellAt(model.cells, '2026-10-02')).toMatchObject({
      inMonth: false,
      countLabel: '4 заявки',
      segments: [{ status: 'reschedule_pending', count: 4, tone: 'warning' }],
    });
  });

  it('подсказка: заголовок, строка на каждый ненулевой статус и флаг «Просрочена»', () => {
    expect(cellAt(model.cells, '2026-09-29').tip).toEqual({
      title: 'Вт, 29 сентября · 66 заявок',
      rows: [
        { key: 'done', label: 'Выполнена', count: 14, tone: 'success' },
        { key: 'in_progress', label: 'В работе', count: 4, tone: 'info' },
        { key: 'en_route', label: 'В пути', count: 2, tone: 'info' },
        { key: 'planned', label: 'Запланирована', count: 42, tone: 'neutral' },
        { key: 'cancel_pending', label: 'Отменяется', count: 1, tone: 'warning' },
        { key: 'unassigned', label: 'Не назначена', count: 3, tone: 'danger' },
        { key: 'late', label: 'Флаг «Просрочена»', count: 1, tone: 'danger' },
      ],
      regions: [],
    });
    // статусы вне полосы в подсказке есть
    expect(cellAt(model.cells, '2026-09-15').tip?.rows.map((row) => row.label)).toEqual([
      'Запланирована',
      'Отменена',
      'Перенесена',
    ]);
  });

  it('легенда — только статусы полосы, которые встречаются в месяце', () => {
    expect(model.legend.map((item) => item.label)).toEqual([
      'Выполнена',
      'В работе',
      'В пути',
      'Запланирована',
      'Отменяется',
      'Не назначена',
    ]);
  });

  it('итог — сумма request_count за месяц без соседних дней', () => {
    expect(model.total).toBe(93);
    expect(model.empty).toBe(false);
  });

  it('фильтр по статусу: число дня — только этот статус (request_count бэк не фильтрует)', () => {
    const filtered = buildCalendarMonth(
      '2026-09',
      { days: [{ date: '2026-09-29', request_count: 372, by_status: { en_route: 12 }, flags: {}, sources: [] }] },
      TODAY,
      { countByStatus: true },
    );
    expect(cellAt(filtered.cells, '2026-09-29')).toMatchObject({ count: 12, countLabel: '12 заявок' });
    expect(filtered.total).toBe(12);
  });

  it('«Все регионы»: сумма регионов и строка на регион в подсказке', () => {
    const day = (count: number, unassigned: number) => ({
      days: [
        {
          date: '2026-09-29',
          request_count: count,
          by_status: { planned: count - unassigned, ...(unassigned ? { unassigned } : {}) },
          flags: {},
          sources: ['demo'],
        },
      ],
    });
    const all = buildCalendarMonth('2026-09', null, TODAY, {
      regions: [
        { regionId: 'east', response: day(70, 0) },
        { regionId: 'south_east', response: day(250, 9) },
        { regionId: 'south_center', response: day(56, 6) },
      ],
    });
    const cell = cellAt(all.cells, '2026-09-29');
    expect(cell).toMatchObject({ count: 376, unassignedLabel: '15 не назначены' });
    expect(cell.tip?.regions).toEqual([
      { regionId: 'east', label: 'Восток', count: 70, unassigned: 0 },
      { regionId: 'south_east', label: 'Юго-восток', count: 250, unassigned: 9 },
      { regionId: 'south_center', label: 'Югоцентр', count: 56, unassigned: 6 },
    ]);
  });

  it('пустой месяц и мусор в ответе', () => {
    const empty = buildCalendarMonth('2026-10', { days: [] }, TODAY);
    expect(empty).toMatchObject({ total: 0, empty: true, legend: [] });
    expect(empty.cells.every((cell) => cell.countLabel === '—')).toBe(true);
    const junk = buildCalendarMonth(
      '2026-09',
      { days: 'нет' } as unknown as CalendarResponse,
      TODAY,
    );
    expect(junk.empty).toBe(true);
    expect(buildCalendarMonth('2026-09', undefined, TODAY).empty).toBe(true);
  });

  it('одна дата несколько раз — суммируем; незнакомые статусы не показываем', () => {
    const merged = buildCalendarMonth(
      '2026-09',
      {
        days: [
          {
            date: '2026-09-03',
            request_count: 2,
            by_status: { planned: 2 },
            flags: {},
            sources: ['booking'],
          },
          {
            date: '2026-09-03',
            request_count: 3,
            by_status: { planned: 1, unassigned: 1, oops: 1 } as never,
            flags: { late: 2 },
            sources: ['csv'],
          },
        ],
      },
      TODAY,
    );
    expect(cellAt(merged.cells, '2026-09-03')).toMatchObject({
      countLabel: '5 заявок',
      csv: true,
      unassignedLabel: '1 не назначена',
      lateLabel: '2 просрочены',
      segments: [
        { status: 'planned', count: 3, tone: 'neutral' },
        { status: 'unassigned', count: 1, tone: 'danger' },
      ],
    });
  });

  it('нет request_count — число заявок по статусам', () => {
    const model2 = buildCalendarMonth(
      '2026-09',
      { days: [{ date: '2026-09-04', by_status: { planned: 2, done: 1 } } as never] },
      TODAY,
    );
    expect(cellAt(model2.cells, '2026-09-04').countLabel).toBe('3 заявки');
  });
});

describe('итог шапки', () => {
  it('число регионов: выбранный — 1, «Все регионы» — из /regions, иначе справочник', () => {
    expect(summaryRegionCount('east', [{}, {}, {}])).toBe(1);
    expect(summaryRegionCount('all', [{}, {}])).toBe(2);
    expect(summaryRegionCount('all', undefined)).toBe(3);
  });

  it('склонения', () => {
    expect(calendarSummary(1314, 3)).toBe('1 314 заявок за месяц · 3 региона');
    expect(calendarSummary(1, 1)).toBe('1 заявка за месяц · 1 регион');
    expect(calendarSummary(22, 5)).toBe('22 заявки за месяц · 5 регионов');
  });
});
