import { describe, expect, it } from 'vitest';
import {
  countCsvRows,
  decodeCsv,
  detectDelimiter,
  formatFileSize,
  parseCsv,
  readCsvRowCount,
} from './csv';

/** Текст → байты Windows-1251 (кириллица и ASCII) — так выгружает оператор связи. */
function cp1251(text: string) {
  return new Uint8Array(
    [...text].map((char) => {
      const code = char.charCodeAt(0);
      if (code < 0x80) return code;
      if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
      if (char === 'Ё') return 0xa8;
      if (char === 'ё') return 0xb8;
      throw new Error(`Нет в Windows-1251: ${char}`);
    }),
  );
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const withBom = (bytes: Uint8Array) => new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);

// Как в выгрузке кейса: заголовок, заявки, пустые строки из разделителей и адрес офиса в конце.
const BEELINE = [
  'Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес',
  '1001;Подключение;Конвергенция абонента;01.10.2026 18:00;01.10.2026 20:00;Район 1;ул. Первая, д. 1',
  '1002;Локальная заявка;Нет линка;01.10.2026 10:00;01.10.2026 12:00;Район 2;ул. Вторая, д. 2',
  '1003;Глобальная проблема;Авария;01.10.2026 00:01;01.10.2026 23:59;Район 3;ул. Третья, д. 3',
  ';;;;;;',
  ';;;;;;',
  'Адрес Офиса;ул. Офисная, д. 1;;;;;',
  '',
].join('\r\n');

describe('decodeCsv', () => {
  it('Windows-1251 — если байты не UTF-8', () => {
    expect(decodeCsv(cp1251('Заявка;Адрес'))).toBe('Заявка;Адрес');
  });

  it('UTF-8 с BOM и без: BOM срезан', () => {
    expect(decodeCsv(withBom(utf8('Заявка;Адрес')))).toBe('Заявка;Адрес');
    expect(decodeCsv(utf8('Заявка;Адрес'))).toBe('Заявка;Адрес');
    expect(decodeCsv(utf8('Заявка;Адрес').buffer as ArrayBuffer)).toBe('Заявка;Адрес');
  });
});

describe('detectDelimiter', () => {
  it('по заголовку: «;» или «,»', () => {
    expect(detectDelimiter(BEELINE)).toBe(';');
    expect(detectDelimiter('\r\nЗаявка,Адрес,Район\n1,"ул. Первая, д. 1",Район 1')).toBe(',');
    expect(detectDelimiter('')).toBe(';');
  });
});

describe('parseCsv', () => {
  it('кавычки: разделитель, перевод строки и "" внутри поля', () => {
    expect(parseCsv('a,"b, c","line 1\nline 2","say ""hi"""\r\nx,y,z,w', ',')).toEqual([
      ['a', 'b, c', 'line 1\nline 2', 'say "hi"'],
      ['x', 'y', 'z', 'w'],
    ]);
  });
});

describe('countCsvRows', () => {
  it('без заголовка, пустых строк «;;;» и строки «Адрес Офиса»', () => {
    expect(countCsvRows(BEELINE)).toBe(3);
  });

  it('одинаково для Windows-1251, UTF-8 и UTF-8 с BOM', () => {
    expect(countCsvRows(decodeCsv(cp1251(BEELINE)))).toBe(3);
    expect(countCsvRows(decodeCsv(utf8(BEELINE)))).toBe(3);
    expect(countCsvRows(decodeCsv(withBom(utf8(BEELINE))))).toBe(3);
  });

  it('разделитель «,», адрес в кавычках с запятыми и переводом строки, LF', () => {
    const text = [
      'Заявка,Тип заявки BK,Адрес',
      '1,Подключение,"ул. Первая, д. 1"',
      '2,Дозаказ,"ул. Вторая,',
      'д. 2"',
      ',,',
      'адрес офиса,"ул. Офисная, д. 1",',
    ].join('\n');
    expect(countCsvRows(text)).toBe(2);
  });

  it('пустой файл и файл из одного заголовка — 0', () => {
    expect(countCsvRows('')).toBe(0);
    expect(countCsvRows('\r\n\r\n')).toBe(0);
    expect(countCsvRows('Заявка;Адрес\r\n')).toBe(0);
  });

  it('контрольный файл без строки офиса', () => {
    const control = [
      'Заявка;Тип заявки BK;Статус BK;Бригада',
      '1001;Подключение;Отправлена;Бригада 1',
      '1002;Подключение;Не отправлена;',
    ].join('\r\n');
    expect(countCsvRows(control)).toBe(2);
  });
});

describe('formatFileSize', () => {
  it('КБ с округлением, от мегабайта — МБ', () => {
    expect(formatFileSize(48 * 1024)).toBe('48 КБ');
    expect(formatFileSize(49_300)).toBe('48 КБ');
    expect(formatFileSize(300)).toBe('1 КБ');
    expect(formatFileSize(0)).toBe('0 КБ');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1,5 МБ');
  });
});

describe('readCsvRowCount', () => {
  it('читает выбранный файл (Windows-1251) и считает строки', async () => {
    const file = new File([cp1251(BEELINE)], 'vostok.csv', { type: 'text/csv' });
    await expect(readCsvRowCount(file)).resolves.toBe(3);
  });
});
