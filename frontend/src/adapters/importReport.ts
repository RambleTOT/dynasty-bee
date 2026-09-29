/**
 * DS-02 шаг 2 «Отчёт импорта»: ответ `POST /data/import-beeline` → карточка региона (FRONTEND_SPEC §8.2).
 *
 * `import_report` в схеме — объект без полей, поэтому читаем его безопасно: любое поле может
 * отсутствовать. Бейдж: «Готово» — замечаний нет; «Есть замечания» — любое замечание (предупреждение,
 * пропущенные строки, нет контрольного файла; таблица финального макета, п. 9); «Ошибка» — бэк
 * отказал (`BAD_CSV`, `ROWS_MISMATCH`, `REGION_UNKNOWN`, `DATE_HAS_BOOKINGS`…), текст — из `ApiError`.
 */
import { errorMessage } from '@/api/errors';
import type { ScenarioSummary } from '@/api/types';
import { transportRuleText } from '@/lib/booking';
import {
  countOf,
  formatInt,
  plural,
  PL_BRIGADE,
  PL_REGION,
  PL_REQUEST,
  PL_ROW,
} from '@/lib/format';

/**
 * Иконка строки: загружено, участок (§14), офис, точки (§14), бригады (§14), нормативы (§14),
 * транспорт, реальный диспетчер, замечание, ошибка.
 */
export type ImportLineKind =
  | 'loaded'
  | 'region'
  | 'office'
  | 'points'
  | 'roster'
  | 'norms'
  | 'transport'
  | 'dispatcher'
  | 'warning'
  | 'error';
export type ImportTone = 'success' | 'warning' | 'danger';
export type ImportBadge = 'ready' | 'remarks' | 'error';

export interface ImportLine {
  kind: ImportLineKind;
  tone: ImportTone;
  text: string;
}

export interface ImportRegionReport {
  regionId: string;
  badge: ImportBadge;
  lines: ImportLine[];
  /** Для подвала «Всего …» и «Открыть день»; `null` — регион не загрузился. */
  loaded: { requests: number; engineers: number } | null;
}

export const IMPORT_BADGE_LABEL: Record<ImportBadge, string> = {
  ready: 'Готово',
  remarks: 'Есть замечания',
  error: 'Ошибка',
};

export const IMPORT_BADGE_TONE: Record<ImportBadge, ImportTone> = {
  ready: 'success',
  remarks: 'warning',
  error: 'danger',
};

const NO_CONTROL_FILE =
  'Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»';

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

const firstOf = <T>(values: unknown[], read: (value: unknown) => T | null): T | null => {
  for (const value of values) {
    const result = read(value);
    if (result !== null && result !== '') return result;
  }
  return null;
};

/** Слова правила D-06 из `required_transport.rule` бэка (п. 55): HD или признак заявки. */
const RULE_WORD: Record<string, string> = {
  'работа с кабелем': 'кабель',
  'гигабитное подключение': 'гигабит',
  авария: 'авария',
};

/** Правило, которым бэк заполнил транспорт: из ответа (п. 55), иначе — известное фронту. */
function transportRule(value: unknown): string {
  const words = Array.isArray(value)
    ? value.map(asText).filter(Boolean).map((name) => RULE_WORD[name.toLowerCase()] ?? name.toLowerCase())
    : [];
  return words.length ? words.join(', ') : transportRuleText();
}

interface SkippedRow {
  row: number | null;
  reason: string;
}

/** `rows_skipped` — список объектов (номер строки и причина); на всякий случай — числа и строки. */
function skippedRows(value: unknown): SkippedRow[] {
  if (!Array.isArray(value)) {
    const count = asCount(value) ?? 0;
    return Array.from({ length: count }, () => ({ row: null, reason: '' }));
  }
  return value.map((item) => {
    if (typeof item === 'number') return { row: asCount(item), reason: '' };
    const object = asObject(item);
    if (!object) return { row: null, reason: asText(item) };
    return {
      row: firstOf([object.row, object.line, object.row_number, object.index], asCount),
      reason: firstOf([object.reason, object.error, object.message, object.detail], asText) ?? '',
    };
  });
}

/** «2 строки пропущены: нет адреса (строки 14, 57)». */
function skippedText(rows: SkippedRow[]): string {
  const head = `${countOf(rows.length, PL_ROW)} ${plural(rows.length, ['пропущена', 'пропущены', 'пропущены'])}`;
  const byReason = new Map<string, number[]>();
  for (const { row, reason } of rows) {
    const list = byReason.get(reason) ?? [];
    if (row !== null) list.push(row);
    byReason.set(reason, list);
  }
  const details = [...byReason]
    .map(([reason, numbers]) => {
      const where = numbers.length
        ? `${numbers.length === 1 ? 'строка' : 'строки'} ${numbers.join(', ')}`
        : '';
      if (!reason) return where;
      return where ? `${reason} (${where})` : reason;
    })
    .filter(Boolean);
  return details.length ? `${head}: ${details.join('; ')}` : head;
}

/**
 * Про контрольный файл: «N заявок без бригады в контрольном файле» (бэк пишет и без файла) или
 * «Контрольный файл не загружен…» (п. 56). Без файла такие строки не показываем — есть своя.
 */
const isControlFileWarning = (text: string) =>
  /контрольн/iu.test(text) && /без\s+бригад|не\s+загружен/iu.test(text);

const mentionsGeocoding = (text: string) => /координат|геокод/iu.test(text);

/** Загрузка своего участка (§14): что сделал мастер «Другой участок» до импорта. */
export interface RegionImportExtra {
  /** Участок создан этой загрузкой; иначе — обновлены его название, офис, нормативы и бригады. */
  created: boolean;
  name: string;
  /** Откуда состав: «из контрольного файла», «по правилу»… */
  rosterSource: string;
  /** Типов заявок в нормативах участка. */
  normTypes: number;
}

/** `unknown_types` отчёта (§14): типы, для которых бэк взял норматив по умолчанию. */
function unknownTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = asObject(item);
    const name = object ? asText(object.type_bk) : asText(item);
    if (!name) return [];
    const count = object ? asCount(object.count) : null;
    return [count ? `${name} (${formatInt(count)})` : name];
  });
}

/**
 * Отчёт региона, который загрузился. `hadControl` — был ли выбран контрольный файл; `extra` —
 * загрузка своего участка (§14).
 */
export function importReportFromSummary(
  regionId: string,
  summary: ScenarioSummary,
  hadControl: boolean,
  extra?: RegionImportExtra,
): ImportRegionReport {
  const report = asObject(summary.import_report) ?? {};
  const skipped = skippedRows(report.rows_skipped);
  const loadedRows = asCount(report.rows_loaded) ?? asCount(summary.request_count) ?? 0;
  const totalRows = asCount(report.rows_total) ?? loadedRows + skipped.length;

  const lines: ImportLine[] = [
    {
      kind: 'loaded',
      tone: loadedRows > 0 ? 'success' : 'warning',
      text: `Загружено ${formatInt(loadedRows)} из ${formatInt(totalRows)} ${plural(totalRows, ['заявки', 'заявок', 'заявок'])}`,
    },
  ];

  if (extra) {
    lines.push({
      kind: 'region',
      tone: 'success',
      text: extra.created
        ? `Участок «${extra.name}» создан`
        : `Участок «${extra.name}»: офис, нормативы и бригады обновлены`,
    });
  }

  // бэк оставляет в адресе хвост пустых колонок CSV: «…д 1с1;;;;;;»
  const office = asText(asObject(report.office)?.address)?.replace(/[\s;,]+$/, '');
  if (office) lines.push({ kind: 'office', tone: 'success', text: `Офис: ${office}` });

  // Адреса без координат бэк ставит у офиса — если об этом нет своего предупреждения, скажем сами.
  const fallback = report.geocode_fallback;
  const unplaced = Array.isArray(fallback) ? fallback.length : (asCount(fallback) ?? 0);

  // §14, только свой участок: точки из загрузки (найдены на клиенте или были в файле), геокодер
  // бэка, офис. У участков кейса бэк тоже шлёт `coords_from_file: 0` — строку не показываем.
  const fromFile = asCount(report.coords_from_file);
  if (extra && fromFile !== null) {
    const byServer = asCount(report.geocoded) ?? 0;
    const parts = [`${formatInt(fromFile)} — по координатам загрузки`];
    if (byServer > 0) parts.push(`${formatInt(byServer)} — нашёл геокодер бэка`);
    if (unplaced > 0) parts.push(`${formatInt(unplaced)} — у офиса`);
    lines.push({
      kind: 'points',
      tone: unplaced > 0 ? 'warning' : 'success',
      text: `Точки заявок: ${parts.join(', ')}`,
    });
  }

  if (extra) {
    const engineers = asCount(summary.engineer_count);
    if (engineers !== null) {
      lines.push({
        kind: 'roster',
        tone: 'success',
        text: `${countOf(engineers, PL_BRIGADE)} — ${extra.rosterSource.toLowerCase()}`,
      });
    }
    lines.push({
      kind: 'norms',
      tone: 'success',
      text: `Нормативы участка: ${formatInt(extra.normTypes)} ${plural(extra.normTypes, ['тип', 'типа', 'типов'])} заявок`,
    });
  }

  const transport = asObject(report.required_transport);
  if (transport) {
    const car = asCount(transport.car) ?? 0;
    const byRule =
      (asCount(transport.car_by_rule) ?? 0) > 0 || /rule/i.test(asText(transport.source));
    lines.push({
      kind: 'transport',
      tone: 'success',
      text:
        car === 0
          ? 'Автомобиль не нужен ни одной заявке'
          : `Автомобиль нужен ${formatInt(car)} ${plural(car, ['заявке', 'заявкам', 'заявкам'])}${byRule ? ` (заполнено правилом: ${transportRule(transport.rule)})` : ''}`,
    });
  }

  const assigned = asCount(report.dispatcher_assignments_loaded);
  if (hadControl && assigned !== null) {
    lines.push({
      kind: 'dispatcher',
      tone: 'success',
      text: `Назначений реального диспетчера: ${formatInt(assigned)} из ${formatInt(loadedRows)}`,
    });
  }

  const warnings = [
    ...new Set(
      (Array.isArray(report.warnings) ? report.warnings : [])
        .map(asText)
        .filter((text) => text && (hadControl || !isControlFileWarning(text))),
    ),
  ];
  const remarks = warnings.map((text): ImportLine => ({ kind: 'warning', tone: 'warning', text }));

  const unknown = unknownTypes(report.unknown_types);
  if (unknown.length) {
    remarks.push({
      kind: 'warning',
      tone: 'warning',
      text: `Нет норматива — взяты локальные работы, 30 мин: ${unknown.join(', ')}`,
    });
  }

  if (unplaced > 0 && !warnings.some(mentionsGeocoding)) {
    remarks.push({
      kind: 'warning',
      tone: 'warning',
      text: `${formatInt(unplaced)} ${plural(unplaced, ['адрес', 'адреса', 'адресов'])} без координат: ${unplaced === 1 ? 'точка поставлена' : 'точки поставлены'} у офиса`,
    });
  }
  if (skipped.length)
    remarks.push({ kind: 'warning', tone: 'warning', text: skippedText(skipped) });
  if (!hadControl) remarks.push({ kind: 'warning', tone: 'warning', text: NO_CONTROL_FILE });

  return {
    regionId,
    badge: remarks.length || loadedRows === 0 ? 'remarks' : 'ready',
    lines: [...lines, ...remarks],
    loaded: {
      requests: asCount(summary.request_count) ?? loadedRows,
      engineers: asCount(summary.engineer_count) ?? 0,
    },
  };
}

/** Регион не загрузился: та же карточка, красный бейдж «Ошибка» и текст ошибки бэка. */
export function importReportFromError(regionId: string, error: unknown): ImportRegionReport {
  return {
    regionId,
    badge: 'error',
    lines: [{ kind: 'error', tone: 'danger', text: errorMessage(error) }],
    loaded: null,
  };
}

/** Подвал: «Всего 147 заявок · 2 региона · 24 бригады»; ни один регион не загрузился — `null`. */
export function importTotals(reports: readonly ImportRegionReport[]): string | null {
  const loaded = reports.flatMap((report) => (report.loaded ? [report.loaded] : []));
  if (loaded.length === 0) return null;
  const requests = loaded.reduce((sum, item) => sum + item.requests, 0);
  const engineers = loaded.reduce((sum, item) => sum + item.engineers, 0);
  return `Всего ${countOf(requests, PL_REQUEST)} · ${countOf(loaded.length, PL_REGION)} · ${countOf(engineers, PL_BRIGADE)}`;
}

/** Регион для «Открыть день» — первый успешно загруженный. */
export function firstLoadedRegion(reports: readonly ImportRegionReport[]): string | null {
  return reports.find((report) => report.loaded)?.regionId ?? null;
}
