/**
 * CSV выгрузок Билайна на клиенте (DS-02, FRONTEND_SPEC §8.2): сколько в файле строк заявок и его размер.
 * Файлы кейса — Windows-1251, разделитель «;», переводы строк CRLF; в конце — пустые строки вида «;;;;»
 * и строка «Адрес Офиса». Читаем и UTF-8 (с BOM и без), и разделители «,» и табуляцию (файлы других
 * участков, §14).
 */

export type CsvDelimiter = ';' | ',' | '\t';
export type CsvEncoding = 'utf-8' | 'windows-1251';

const hasUtf8Bom = (bytes: Uint8Array) =>
  bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

/** Байты файла → текст и кодировка: UTF-8 (BOM срезаем); если байты — не UTF-8, то Windows-1251. */
export function decodeCsvText(data: ArrayBuffer | Uint8Array): {
  text: string;
  encoding: CsvEncoding;
} {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const body = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(body), encoding: 'windows-1251' };
  }
}

/** Байты файла → текст (см. `decodeCsvText`). */
export const decodeCsv = (data: ArrayBuffer | Uint8Array): string => decodeCsvText(data).text;

const occurrences = (text: string, char: string) => text.split(char).length - 1;

/**
 * Разделитель — по первой непустой строке (заголовку): табуляция, если её больше всего; иначе «;»,
 * если запятых не больше.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const header = text.split(/\r\n|\n|\r/).find((line) => line.trim() !== '') ?? '';
  const semicolons = occurrences(header, ';');
  const commas = occurrences(header, ',');
  if (occurrences(header, '\t') > Math.max(semicolons, commas)) return '\t';
  return commas > semicolons ? ',' : ';';
}

/**
 * Записи CSV. Кавычки — по RFC 4180: разделитель и перевод строки внутри кавычек поле не делят,
 * `""` внутри кавычек — одна кавычка. Переводы строк — CRLF, LF или CR.
 */
export function parseCsv(
  text: string,
  delimiter: CsvDelimiter = detectDelimiter(text),
): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export const isBlankRecord = (record: readonly string[]) =>
  record.every((cell) => cell.trim() === '');

/** Служебная строка выгрузки с адресом офиса — не заявка. */
const OFFICE_ROW = /^адрес\s+офиса/iu;
export const isOfficeRow = (record: readonly string[]) =>
  OFFICE_ROW.test(record.find((cell) => cell.trim() !== '')?.trim() ?? '');

/** Строк заявок в файле: без заголовка, пустых строк (в том числе «;;;;») и строки «Адрес Офиса». */
export function countCsvRows(text: string): number {
  const records = parseCsv(text).filter((record) => !isBlankRecord(record));
  return records.slice(1).filter((record) => !isOfficeRow(record)).length;
}

/** Размер файла: «48 КБ», от мегабайта — «1,2 МБ». */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 КБ';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} КБ`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} МБ`;
}

function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  // Запасной путь для окружений без Blob.arrayBuffer (jsdom в тестах).
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.readAsArrayBuffer(file);
  });
}

/** Сколько строк заявок в выбранном файле — считаем на клиенте, до загрузки. */
export async function readCsvRowCount(file: Blob): Promise<number> {
  return countCsvRows(decodeCsv(await readBytes(file)));
}

/** Текст файла и его кодировка. */
export async function readCsvText(file: Blob): Promise<{ text: string; encoding: CsvEncoding }> {
  return decodeCsvText(await readBytes(file));
}
