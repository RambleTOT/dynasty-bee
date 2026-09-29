/**
 * Строки другого участка → CSV в выданном формате Билайна: его читает `POST /data/import-beeline`.
 * UTF-8, разделитель «;», время окна — «ДД.ММ.ГГГГ ЧЧ:ММ», в конце — «Адрес офиса;…».
 * Колонки §14 «Навык», «Длительность», «Широта», «Долгота» — нормативы участка и найденные точки
 * по каждой строке: бэк без правки §14 их пропустит и возьмёт свои нормативы и геокодинг.
 */
import type { RequestRow } from './columnMap';
import type { Norm } from './regionNorms';

export const REQUEST_COLUMNS = [
  'Заявка',
  'Тип заявки BK',
  'Тип заявки HD',
  'Начало',
  'Окончание',
  'Район',
  'Адрес',
  'Гигабитное подключение',
  'Подключение',
  'Требуемый транспорт',
  'Навык',
  'Длительность',
  'Широта',
  'Долгота',
] as const;

export interface Point {
  lat: number;
  lon: number;
}

/** Поле CSV: переводы строк — пробелом; «;» и кавычки — в кавычках (RFC 4180, как читает бэк). */
function cell(value: string | number | null | undefined): string {
  const text = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return /[;"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** «2026-10-01» + «10:00» → «01.10.2026 10:00»; окна нет — пусто (бэк подставит смену). */
function dateTime(date: string, clock: string | null): string {
  if (!clock) return '';
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year} ${clock}`;
}

/** Строку офиса бэк читает без разбора кавычек: «;» в адресе заменяем запятой. */
const officeLine = (address: string) =>
  `Адрес офиса;${address
    .replace(/\s*[\r\n;]+\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()}`;

const coordinate = (value: number) => value.toFixed(6);

export interface RequestsCsvInput {
  rows: readonly RequestRow[];
  date: string;
  normOf: (typeBk: string) => Norm | null;
  /** Точка заявки по `RequestRow.source`: из файла, найдена по адресу или поставлена на карте. */
  points: ReadonlyMap<number, Point>;
  officeAddress: string;
}

export function requestsCsv({
  rows,
  date,
  normOf,
  points,
  officeAddress,
}: RequestsCsvInput): string {
  const lines = rows.map((row) => {
    const norm = normOf(row.typeBk);
    const point = points.get(row.source);
    return [
      row.id,
      row.typeBk,
      row.typeHd,
      dateTime(date, row.start),
      dateTime(date, row.end),
      row.district,
      row.address,
      row.gigabit ? 'Да' : 'Нет',
      row.technology,
      row.transport ?? '',
      norm?.skill ?? '',
      row.duration ?? norm?.duration ?? '',
      point ? coordinate(point.lat) : '',
      point ? coordinate(point.lon) : '',
    ]
      .map(cell)
      .join(';');
  });
  return [REQUEST_COLUMNS.join(';'), ...lines, officeLine(officeAddress)].join('\r\n');
}

/**
 * Контрольное распределение в том же порядке строк, что и заявки: бэк сверяет файлы по порядку и
 * требует те же обязательные колонки. Бригада — по `RequestRow.source`.
 */
export function controlCsv({
  rows,
  date,
  brigades,
  officeAddress,
}: {
  rows: readonly RequestRow[];
  date: string;
  brigades: ReadonlyMap<number, string>;
  officeAddress: string;
}): string {
  const header = ['Заявка', 'Тип заявки BK', 'Начало', 'Окончание', 'Адрес', 'Бригада'];
  const lines = rows.map((row) =>
    [
      row.id,
      row.typeBk,
      dateTime(date, row.start),
      dateTime(date, row.end),
      row.address,
      brigades.get(row.source) ?? '',
    ]
      .map(cell)
      .join(';'),
  );
  return [header.join(';'), ...lines, officeLine(officeAddress)].join('\r\n');
}
