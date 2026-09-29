import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import type { ScenarioSummary } from '@/api/types';
import {
  firstLoadedRegion,
  importReportFromError,
  importReportFromSummary,
  importTotals,
} from './importReport';

function summary(
  importReport: Record<string, unknown> | null,
  counts = { requests: 66, engineers: 12 },
) {
  return {
    scenario_id: 'sc-1',
    name: 'Восток',
    created_at: '2026-09-29T07:00:00Z',
    engineer_count: counts.engineers,
    request_count: counts.requests,
    skills: [],
    transports: [],
    region_id: 'east',
    date: '2026-09-29',
    source: 'csv',
    import_report: importReport,
  } satisfies ScenarioSummary;
}

// Форма import_report — как у бэка (сверено по исходникам).
const FULL = {
  rows_total: 66,
  rows_loaded: 66,
  rows_skipped: [],
  office: { address: 'г. Москва, ул. Офисная, д. 1', lat: 55.7, lon: 37.7 },
  geocoded_from_cache: 60,
  geocode_fallback: [],
  required_transport: { source: 'rule', car: 7, car_by_rule: 7 },
  dispatcher_assignments_loaded: 64,
  warnings: [],
};

describe('importReportFromSummary', () => {
  it('всё загружено, есть контрольный файл, замечаний нет → «Готово»', () => {
    const report = importReportFromSummary('east', summary(FULL), true);
    expect(report.badge).toBe('ready');
    expect(report.lines).toEqual([
      { kind: 'loaded', tone: 'success', text: 'Загружено 66 из 66 заявок' },
      { kind: 'office', tone: 'success', text: 'Офис: г. Москва, ул. Офисная, д. 1' },
      {
        kind: 'transport',
        tone: 'success',
        text: 'Автомобиль нужен 7 заявкам (заполнено правилом: кабель, авария)',
      },
      { kind: 'dispatcher', tone: 'success', text: 'Назначений реального диспетчера: 64 из 66' },
    ]);
    expect(report.loaded).toEqual({ requests: 66, engineers: 12 });
  });

  it('любое предупреждение → «Есть замечания», предупреждения — списком', () => {
    const report = importReportFromSummary(
      'east',
      summary({ ...FULL, warnings: ['2 заявки в контрольном файле без бригады'] }),
      true,
    );
    expect(report.badge).toBe('remarks');
    expect(report.lines.at(-1)).toEqual({
      kind: 'warning',
      tone: 'warning',
      text: '2 заявки в контрольном файле без бригады',
    });
  });

  it('без контрольного файла: своя строка, предупреждение бэка о бригадах не дублируем', () => {
    const report = importReportFromSummary(
      'south_east',
      summary({
        ...FULL,
        rows_total: 83,
        rows_loaded: 81,
        rows_skipped: [
          { row: 14, reason: 'нет адреса' },
          { row: 57, reason: 'нет адреса' },
        ],
        dispatcher_assignments_loaded: 0,
        warnings: ['81 заявка без бригады в контрольном файле'],
      }),
      false,
    );
    expect(report.badge).toBe('remarks');
    expect(report.lines.map((line) => line.text)).toEqual([
      'Загружено 81 из 83 заявок',
      'Офис: г. Москва, ул. Офисная, д. 1',
      'Автомобиль нужен 7 заявкам (заполнено правилом: кабель, авария)',
      '2 строки пропущены: нет адреса (строки 14, 57)',
      'Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»',
    ]);
  });

  it('новые дни 28–29.09 (п. 55, 56): правило из ответа бэка, «файл не загружен» — одной строкой', () => {
    const report = importReportFromSummary(
      'east',
      summary({
        ...FULL,
        rows_total: 74,
        rows_loaded: 74,
        required_transport: {
          source: 'column+rule',
          car: 6,
          car_by_rule: 6,
          rule: ['Работа с кабелем', 'Авария'],
        },
        dispatcher_assignments_loaded: 0,
        warnings: ['Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»'],
      }),
      false,
    );
    expect(report.lines.map((line) => line.text)).toEqual([
      'Загружено 74 из 74 заявок',
      'Офис: г. Москва, ул. Офисная, д. 1',
      'Автомобиль нужен 6 заявкам (заполнено правилом: кабель, авария)',
      'Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»',
    ]);
  });

  it('пропущенные строки: разные причины, без номеров, одна строка', () => {
    const text = (rowsSkipped: unknown) =>
      importReportFromSummary(
        'east',
        summary({ ...FULL, rows_skipped: rowsSkipped }),
        true,
      ).lines.find((line) => line.text.includes('пропущ'))?.text;
    expect(
      text([
        { line: 3, error: 'нет адреса' },
        { row: 9, reason: 'неизвестный тип' },
      ]),
    ).toBe('2 строки пропущены: нет адреса (строка 3); неизвестный тип (строка 9)');
    expect(text([{ row: 5 }])).toBe('1 строка пропущена: строка 5');
    expect(text([{}, {}, {}, {}, {}])).toBe('5 строк пропущены');
    expect(text([])).toBeUndefined();
  });

  it('адреса без координат — замечание, если бэк сам о них не написал', () => {
    const own = importReportFromSummary(
      'east',
      summary({
        ...FULL,
        geocode_fallback: ['ул. Первая, д. 1', 'ул. Вторая, д. 2', 'ул. Третья'],
      }),
      true,
    );
    expect(own.badge).toBe('remarks');
    expect(own.lines.at(-1)?.text).toBe('3 адреса без координат: точки поставлены у офиса');

    const fromBackend = importReportFromSummary(
      'east',
      summary({
        ...FULL,
        geocode_fallback: ['ул. Первая, д. 1'],
        warnings: ['1 адрес не найден геокодером: точка у офиса'],
      }),
      true,
    );
    expect(fromBackend.lines.filter((line) => line.kind === 'warning')).toHaveLength(1);
  });

  it('транспорт: без правила — без скобок; нет поля — нет строки', () => {
    const column = importReportFromSummary(
      'east',
      summary({ ...FULL, required_transport: { source: 'column', car: 1, car_by_rule: 0 } }),
      true,
    );
    expect(column.lines.find((line) => line.kind === 'transport')?.text).toBe(
      'Автомобиль нужен 1 заявке',
    );
    const none = importReportFromSummary(
      'east',
      summary({ ...FULL, required_transport: undefined }),
      true,
    );
    expect(none.lines.some((line) => line.kind === 'transport')).toBe(false);
  });

  it('отчёта нет — строка «Загружено» по request_count, остальное не выдумываем', () => {
    const report = importReportFromSummary(
      'east',
      summary(null, { requests: 56, engineers: 11 }),
      true,
    );
    expect(report.lines).toEqual([
      { kind: 'loaded', tone: 'success', text: 'Загружено 56 из 56 заявок' },
    ]);
    expect(report.badge).toBe('ready');
    expect(report.loaded).toEqual({ requests: 56, engineers: 11 });
  });
});

describe('тексты для нуля и единицы', () => {
  it('машина никому не нужна; один адрес у офиса', () => {
    const report = importReportFromSummary(
      'east',
      summary({
        ...FULL,
        required_transport: { source: 'rule', car: 0, car_by_rule: 0 },
        geocode_fallback: ['ул. Первая, 1'],
      }),
      true,
    );
    const texts = report.lines.map((line) => line.text);
    expect(texts).toContain('Автомобиль не нужен ни одной заявке');
    expect(texts).toContain('1 адрес без координат: точка поставлена у офиса');
  });
});

describe('свой участок (§14)', () => {
  const extra = { created: true, name: 'Север', rosterSource: 'Из контрольного файла', normTypes: 5 };

  it('участок создан, точки из загрузки, бригады и нормативы — строками отчёта', () => {
    const report = importReportFromSummary(
      'r-1',
      summary(
        { ...FULL, rows_total: 40, rows_loaded: 40, coords_from_file: 36, geocoded: 2, geocode_fallback: ['а', 'б'] },
        { requests: 40, engineers: 9 },
      ),
      true,
      extra,
    );
    expect(report.lines.map((line) => [line.kind, line.text])).toEqual([
      ['loaded', 'Загружено 40 из 40 заявок'],
      ['region', 'Участок «Север» создан'],
      ['office', 'Офис: г. Москва, ул. Офисная, д. 1'],
      ['points', 'Точки заявок: 36 — по координатам загрузки, 2 — нашёл геокодер бэка, 2 — у офиса'],
      ['roster', '9 бригад — из контрольного файла'],
      ['norms', 'Нормативы участка: 5 типов заявок'],
      ['transport', 'Автомобиль нужен 7 заявкам (заполнено правилом: кабель, авария)'],
      ['dispatcher', 'Назначений реального диспетчера: 64 из 40'],
      ['warning', '2 адреса без координат: точки поставлены у офиса'],
    ]);
    expect(report.badge).toBe('remarks');
  });

  it('обновлённый участок; типы без норматива — замечание', () => {
    const report = importReportFromSummary(
      'r-1',
      summary({ ...FULL, coords_from_file: 66, unknown_types: [{ type_bk: 'Ремонт ТВ', count: 4 }, 'Прочее'] }),
      true,
      { ...extra, created: false, normTypes: 1 },
    );
    expect(report.lines.find((line) => line.kind === 'region')?.text).toBe(
      'Участок «Север»: офис, нормативы и бригады обновлены',
    );
    expect(report.lines.find((line) => line.kind === 'norms')?.text).toBe(
      'Нормативы участка: 1 тип заявок',
    );
    expect(report.lines.at(-1)).toEqual({
      kind: 'warning',
      tone: 'warning',
      text: 'Нет норматива — взяты локальные работы, 30 мин: Ремонт ТВ (4), Прочее',
    });
  });

  it('участок кейса: строк §14 нет, даже если бэк прислал поля §14', () => {
    const report = importReportFromSummary(
      'east',
      summary({ ...FULL, coords_from_file: 0, geocoded: 66, unknown_types: [] }),
      true,
    );
    expect(report.lines.map((line) => line.kind)).toEqual(['loaded', 'office', 'transport', 'dispatcher']);
  });
});

describe('importReportFromError', () => {
  it('ошибка бэка → «Ошибка» и текст из ApiError', () => {
    const error = new ApiError(
      422,
      'BAD_CSV',
      'В файле нет колонок: Тип заявки BK, Адрес. Проверьте, что это выгрузка оператора связи',
    );
    expect(importReportFromError('south_center', error)).toEqual({
      regionId: 'south_center',
      badge: 'error',
      lines: [
        {
          kind: 'error',
          tone: 'danger',
          text: 'В файле нет колонок: Тип заявки BK, Адрес. Проверьте, что это выгрузка оператора связи',
        },
      ],
      loaded: null,
    });
  });

  it('не ApiError — общий текст', () => {
    expect(importReportFromError('east', new Error('boom')).lines[0].text).toBe(
      'Не удалось выполнить запрос. Повторите',
    );
  });
});

describe('подвал', () => {
  it('«Всего N заявок · K региона · M бригад» — только по загруженным регионам', () => {
    const reports = [
      importReportFromError('east', new ApiError(409, 'DATE_HAS_BOOKINGS', 'На дату есть записи')),
      importReportFromSummary('south_east', summary(FULL, { requests: 66, engineers: 12 }), true),
      importReportFromSummary(
        'south_center',
        summary(FULL, { requests: 81, engineers: 12 }),
        false,
      ),
    ];
    expect(importTotals(reports)).toBe('Всего 147 заявок · 2 региона · 24 бригады');
    expect(firstLoadedRegion(reports)).toBe('south_east');
  });

  it('ничего не загрузилось — без итога и без дня', () => {
    const reports = [importReportFromError('east', new Error('x'))];
    expect(importTotals(reports)).toBeNull();
    expect(firstLoadedRegion(reports)).toBeNull();
  });
});
