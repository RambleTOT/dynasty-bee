/**
 * CSV другого участка (§14, `anyRegionEnabled`): таблица файла до сопоставления колонок.
 * Кодировка — UTF-8 или Windows-1251, разделитель — «;», «,» или табуляция. Пустые строки и строку
 * «Адрес офиса;…» (выгрузки Билайна) из заявок убираем, адрес офиса запоминаем.
 */
import {
  detectDelimiter,
  isBlankRecord,
  isOfficeRow,
  parseCsv,
  readCsvText,
  type CsvDelimiter,
  type CsvEncoding,
} from '@/lib/csv';

export interface CsvTable {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  /** Названия колонок как в файле, без пробелов по краям. */
  header: string[];
  /** Строки данных, по длине заголовка. */
  rows: string[][];
  /** Номер строки файла для каждой строки `rows` (заголовок — строка 1): «строка 14». */
  lines: number[];
  officeAddress: string | null;
}

/** «Адрес Офиса;г. Москва, …;;;» или «Адрес офиса: г. Москва, …» → адрес. */
function officeOf(record: readonly string[]): string | null {
  const [first = '', ...rest] = record.map((cell) => cell.trim()).filter(Boolean);
  const inline = first.replace(/^адрес\s+офиса\s*[:\-–]?\s*/iu, '');
  return [inline, ...rest].filter(Boolean).join(', ') || null;
}

export function toCsvTable(text: string, encoding: CsvEncoding = 'utf-8'): CsvTable {
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  const headerIndex = records.findIndex((record) => !isBlankRecord(record));
  const table: CsvTable = {
    encoding,
    delimiter,
    header: [],
    rows: [],
    lines: [],
    officeAddress: null,
  };
  if (headerIndex === -1) return table;

  const header = records[headerIndex].map((cell) => cell.trim());
  // хвост пустых колонок заголовка: «Заявка;Адрес;;;»
  while (header.length > 1 && header[header.length - 1] === '') header.pop();
  table.header = header;
  records.forEach((record, index) => {
    if (index <= headerIndex || isBlankRecord(record)) return;
    if (isOfficeRow(record)) {
      table.officeAddress = officeOf(record) ?? table.officeAddress;
      return;
    }
    table.rows.push(header.map((_, column) => (record[column] ?? '').trim()));
    table.lines.push(index + 1);
  });
  return table;
}

export async function readCsvTable(file: Blob): Promise<CsvTable> {
  const { text, encoding } = await readCsvText(file);
  return toCsvTable(text, encoding);
}

export const ENCODING_LABEL: Record<CsvEncoding, string> = {
  'utf-8': 'UTF-8',
  'windows-1251': 'Windows-1251',
};

export const DELIMITER_LABEL: Record<CsvDelimiter, string> = {
  ';': '«;»',
  ',': '«,»',
  '\t': 'табуляция',
};
