/**
 * Колонки CSV другого участка (§14, `anyRegionEnabled`): поле угадываем по названию колонки,
 * диспетчер поправляет, ячейки разбираем в поля заявки. На бэк строки уходят в выданном формате
 * оператора связи (canonicalCsv.ts): другой формат бэк не читает.
 */
import { FEATURES } from '@/config';
import { transportRuleText } from '@/lib/booking';
import { SKILLS, TRANSPORTS, type Skill, type Transport } from '@/lib/statuses';
import type { CsvTable } from './csvTable';

export interface FieldDef<F extends string = string> {
  key: F;
  label: string;
  /** Зачем поле: «по нему найдём точку на карте». */
  hint?: string;
  /** Названия колонок в нижнем регистре: сначала точное совпадение, потом — начало названия. */
  names: readonly string[];
  required?: boolean;
  /** Необязательное поле «если есть в файле»: без колонки — свёрнуто. */
  extra?: boolean;
}

/** Поле → номер колонки файла; `null` — колонки нет. */
export type Mapping<F extends string> = Record<F, number | null>;

export type RequestField =
  | 'id'
  | 'typeBk'
  | 'typeHd'
  | 'start'
  | 'end'
  | 'window'
  | 'address'
  | 'district'
  | 'gigabit'
  | 'technology'
  | 'transport'
  | 'duration'
  | 'lat'
  | 'lon';

const ID_NAMES = [
  'заявка',
  'номер заявки',
  '№ заявки',
  'номер',
  'id',
  'id заявки',
  '№',
  'request_id',
];

/** До п. 55 бэка гигабит требует автомобиль (правило D-06), после — только признак заявки (D-40). */
const GIGABIT_HINT = FEATURES.transportRuleNoGigabit
  ? 'признак в карточке заявки'
  : '«Да» — по правилу нужен автомобиль';

export const REQUEST_FIELDS: readonly FieldDef<RequestField>[] = [
  { key: 'id', label: 'Номер заявки', hint: 'нет — пронумеруем сами', names: ID_NAMES },
  {
    key: 'typeBk',
    label: 'Тип заявки',
    hint: 'по нему — нормативы на шаге 3',
    required: true,
    names: [
      'тип заявки bk',
      'тип заявки',
      'тип',
      'тип работ',
      'вид работ',
      'вид заявки',
      'type_bk',
      'type',
    ],
  },
  {
    key: 'typeHd',
    label: 'Подтип (HD)',
    hint: 'уточнение типа, как в выданной выгрузке',
    extra: true,
    names: ['тип заявки hd', 'подтип', 'type_hd', 'hd'],
  },
  {
    key: 'start',
    label: 'Начало окна',
    hint: 'окно визита, обещанное клиенту',
    names: ['начало', 'начало окна', 'окно с', 'время с', 'с', 'window_start', 'start'],
  },
  {
    key: 'end',
    label: 'Конец окна',
    names: [
      'окончание',
      'конец',
      'конец окна',
      'окно по',
      'окно до',
      'время по',
      'время до',
      'по',
      'до',
      'window_end',
      'end',
    ],
  },
  {
    key: 'window',
    label: 'Окно одной колонкой',
    hint: 'если в ячейке «10:00–12:00»',
    names: ['окно', 'интервал', 'время визита', 'слот', 'window'],
  },
  {
    key: 'address',
    label: 'Адрес',
    hint: 'по нему найдём точку на карте',
    required: true,
    names: ['адрес', 'адрес клиента', 'адрес объекта', 'адрес заявки', 'address'],
  },
  {
    key: 'district',
    label: 'Район',
    hint: 'подпись в карточке заявки',
    extra: true,
    names: ['район', 'округ', 'district'],
  },
  {
    key: 'gigabit',
    label: 'Гигабитное подключение',
    hint: GIGABIT_HINT,
    extra: true,
    names: ['гигабитное подключение', 'гигабит', 'gigabit'],
  },
  {
    key: 'technology',
    label: 'Технология подключения',
    hint: 'FMC, FTTB',
    extra: true,
    names: ['подключение', 'технология', 'technology'],
  },
  {
    key: 'transport',
    label: 'Требуемый транспорт',
    hint: `нет — по правилу: ${transportRuleText()}`,
    extra: true,
    names: ['требуемый транспорт', 'транспорт', 'required_transport'],
  },
  {
    key: 'duration',
    label: 'Длительность, мин',
    hint: 'нет — по нормативу участка',
    extra: true,
    names: [
      'длительность',
      'длительность, мин',
      'длительность работ',
      'норматив',
      'норматив, мин',
      'duration_minutes',
      'duration',
    ],
  },
  {
    key: 'lat',
    label: 'Широта',
    hint: 'есть с долготой — адрес не ищем',
    extra: true,
    names: ['широта', 'latitude', 'lat'],
  },
  { key: 'lon', label: 'Долгота', extra: true, names: ['долгота', 'longitude', 'lon', 'lng'] },
];

export type ControlField = 'id' | 'brigade';

export const CONTROL_FIELDS: readonly FieldDef<ControlField>[] = [
  {
    key: 'id',
    label: 'Номер заявки',
    hint: 'по нему находим заявку; нет — по порядку строк',
    names: ID_NAMES,
  },
  {
    key: 'brigade',
    label: 'Бригада',
    hint: 'кто выполнял заявку у реального диспетчера',
    required: true,
    names: [
      'бригада',
      'исполнитель',
      'инженер',
      'монтажник',
      'техник',
      'сотрудник',
      'brigade',
      'engineer',
    ],
  },
];

export type RosterField = 'name' | 'skills' | 'transport' | 'shiftStart' | 'shiftEnd';

export const ROSTER_FIELDS: readonly FieldDef<RosterField>[] = [
  {
    key: 'name',
    label: 'Бригада',
    required: true,
    names: ['бригада', 'фио', 'имя', 'название', 'инженер', 'сотрудник', 'исполнитель', 'name'],
  },
  {
    key: 'skills',
    label: 'Навыки',
    hint: 'нет — все три навыка',
    names: ['навыки', 'навык', 'квалификация', 'компетенции', 'skills'],
  },
  {
    key: 'transport',
    label: 'Транспорт',
    hint: 'нет — автомобиль',
    names: ['транспорт', 'transport'],
  },
  {
    key: 'shiftStart',
    label: 'Начало смены',
    hint: 'нет — по окнам заявок',
    names: ['начало смены', 'смена с', 'начало', 'с', 'shift_start'],
  },
  {
    key: 'shiftEnd',
    label: 'Конец смены',
    names: [
      'конец смены',
      'окончание смены',
      'смена до',
      'смена по',
      'окончание',
      'конец',
      'до',
      'по',
      'shift_end',
    ],
  },
];

/** «Тип заявки BK:» → «тип заявки bk». */
export const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s_]+/g, ' ')
    .replace(/[\s:.*]+$/, '')
    .trim();

/** Поля по названиям колонок: сначала точные совпадения, затем колонки, которые начинаются с названия. */
export function guessMapping<F extends string>(
  fields: readonly FieldDef<F>[],
  header: readonly string[],
): Mapping<F> {
  const names = header.map(normalizeName);
  const mapping = Object.fromEntries(fields.map((field) => [field.key, null])) as Mapping<F>;
  const taken = new Set<number>();
  const assign = (matches: (name: string, field: FieldDef<F>) => boolean) => {
    for (const field of fields) {
      if (mapping[field.key] !== null) continue;
      const index = names.findIndex(
        (name, column) => !taken.has(column) && name !== '' && matches(name, field),
      );
      if (index === -1) continue;
      mapping[field.key] = index;
      taken.add(index);
    }
  };
  assign((name, field) => field.names.includes(name));
  assign((name, field) => field.names.some((known) => known.length >= 4 && name.startsWith(known)));
  return mapping;
}

/** Обязательные поля без колонки и колонки, выбранные для двух полей. */
export function mappingErrors<F extends string>(
  fields: readonly FieldDef<F>[],
  mapping: Mapping<F>,
  header: readonly string[],
): string[] {
  const errors = fields
    .filter((field) => field.required && mapping[field.key] === null)
    .map((field) => `Выберите колонку «${field.label}»`);
  const byColumn = new Map<number, string[]>();
  for (const field of fields) {
    const column = mapping[field.key];
    if (column === null) continue;
    byColumn.set(column, [...(byColumn.get(column) ?? []), `«${field.label}»`]);
  }
  for (const [column, labels] of byColumn) {
    if (labels.length > 1)
      errors.push(`Колонка «${header[column] ?? column + 1}» выбрана дважды: ${labels.join(', ')}`);
  }
  return errors;
}

/** Файл заявок: плюс окно (начало и конец или одной колонкой) и координаты парой. */
export function requestMappingErrors(
  mapping: Mapping<RequestField>,
  header: readonly string[],
): string[] {
  const errors = mappingErrors(REQUEST_FIELDS, mapping, header);
  if (mapping.window === null && (mapping.start === null || mapping.end === null))
    errors.push('Выберите «Начало окна» и «Конец окна» или «Окно одной колонкой»');
  if ((mapping.lat === null) !== (mapping.lon === null))
    errors.push('Широта и долгота — обе колонки или ни одной');
  return errors;
}

// --- ячейки ---

const pad = (value: number) => String(value).padStart(2, '0');

function clockOf(hours: number, minutes: number): string | null {
  if (hours === 24 && minutes === 0) return '23:59';
  if (!(hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59)) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Время: «18:00», «18.00», «18», «18:00:00», «17.08.2026 18:00», «2026-08-17T18:00». */
export function parseClock(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const dated = text.match(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}[\sT,]+(\d{1,2})[:.](\d{2})/u);
  if (dated) return clockOf(Number(dated[1]), Number(dated[2]));
  const time = text.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(?:ч\.?|час(?:а|ов)?)?$/iu);
  return time ? clockOf(Number(time[1]), Number(time[2] ?? 0)) : null;
}

/** Окно одной ячейкой: «10:00-12:00», «10–12», «с 10 до 12», «17.08.2026 10:00 – 17.08.2026 12:00». */
export function parseWindowCell(raw: string): { start: string; end: string } | null {
  const text = raw.trim();
  const clocks = [...text.matchAll(/(\d{1,2}):(\d{2})/g)];
  let start: string | null = null;
  let end: string | null = null;
  if (clocks.length >= 2) {
    start = clockOf(Number(clocks[0][1]), Number(clocks[0][2]));
    end = clockOf(Number(clocks[1][1]), Number(clocks[1][2]));
  } else {
    const hours = text.match(
      /^(?:с\s*)?(\d{1,2})(?:[.:](\d{2}))?\s*(?:-|–|—|до|по)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(?:ч\.?)?$/iu,
    );
    if (!hours) return null;
    start = clockOf(Number(hours[1]), Number(hours[2] ?? 0));
    end = clockOf(Number(hours[3]), Number(hours[4] ?? 0));
  }
  return start && end ? { start, end } : null;
}

const TRUE_CELLS = new Set(['да', 'д', 'true', 'yes', 'y', '1', '+', 'есть']);
const FALSE_CELLS = new Set(['нет', 'н', 'false', 'no', 'n', '0', '-', '']);

/** «Да» / «Нет» и их варианты; непонятное — `null`. */
export function parseBoolCell(raw: string): boolean | null {
  const text = raw.trim().toLowerCase();
  if (TRUE_CELLS.has(text)) return true;
  if (FALSE_CELLS.has(text)) return false;
  return null;
}

/** «55,7512» → 55.7512. */
export function parseNumberCell(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Работа без дороги, мин: 5 минут — 8 часов. */
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;

/** «70», «70 мин», «1:10», «1,5 ч», «1 ч 10 мин» → минуты. */
export function parseDurationCell(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(',', '.');
  if (!text) return null;
  let minutes: number | null = null;
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2]);
  else if (/^\d+(?:\.\d+)?$/.test(text)) minutes = Math.round(Number(text));
  else {
    const hours = text.match(/(\d+(?:\.\d+)?)\s*ч/u);
    const mins = text.match(/(\d+)\s*м/u);
    if (hours || mins) minutes = Math.round(Number(hours?.[1] ?? 0) * 60 + Number(mins?.[1] ?? 0));
  }
  return minutes !== null && minutes >= DURATION_MIN && minutes <= DURATION_MAX ? minutes : null;
}

const TRANSPORT_WORDS: Record<string, Transport> = {
  автомобиль: 'car',
  авто: 'car',
  машина: 'car',
  'на машине': 'car',
  'на автомобиле': 'car',
  пешком: 'walk',
  пешеход: 'walk',
  велосипед: 'bike',
  'на велосипеде': 'bike',
  'общественный транспорт': 'public_transport',
  общественный: 'public_transport',
  'на общественном транспорте': 'public_transport',
  от: 'public_transport',
};

/** «Автомобиль», «car», «пешком» → транспорт; непонятное — `null`. */
export function parseTransportCell(raw: string): Transport | null {
  const id = raw.trim().toLowerCase();
  if ((TRANSPORTS as readonly string[]).includes(id)) return id as Transport;
  return TRANSPORT_WORDS[normalizeName(raw)] ?? null;
}

const SKILL_WORDS: Record<Skill, RegExp> = {
  local: /локал|ремонт|\blocal\b/iu,
  installation: /подключ|дозаказ|монтаж|установк|\binstallation\b/iu,
  emergency: /авари|\bemergency\b/iu,
};

/** «Работы на подключение и дозаказы; Локальные работы» → навыки по ключевым словам. */
export function parseSkillsCell(raw: string): Skill[] {
  return SKILLS.filter((skill) => SKILL_WORDS[skill].test(raw));
}

// --- строки ---

export interface RequestRow {
  /** Номер строки данных в файле заявок — по нему связываем контрольный файл «по порядку» и точки. */
  source: number;
  /** Строка файла для сообщений. */
  line: number;
  id: string;
  typeBk: string;
  typeHd: string;
  /** Окно «HH:MM»; нет — весь день смены (бэк подставит смену). */
  start: string | null;
  end: string | null;
  address: string;
  district: string;
  gigabit: boolean;
  technology: string;
  transport: Transport | null;
  /** Длительность из файла, мин; нет — по нормативу участка. */
  duration: number | null;
  lat: number | null;
  lon: number | null;
}

export interface RowNote {
  line: number;
  text: string;
}

export interface RequestsRead {
  rows: RequestRow[];
  /** Строки, которые не загрузим. */
  skipped: RowNote[];
  /** Загрузим, но с оговоркой. */
  notes: RowNote[];
}

const inRange = (value: number | null, limit: number) =>
  value !== null && Math.abs(value) <= limit ? value : null;

/** Строки файла заявок по сопоставлению колонок. Без адреса — пропускаем: точку не поставить. */
export function readRequests(table: CsvTable, mapping: Mapping<RequestField>): RequestsRead {
  const rows: RequestRow[] = [];
  const skipped: RowNote[] = [];
  const notes: RowNote[] = [];
  const seen = new Map<string, number>();

  table.rows.forEach((cells, source) => {
    const line = table.lines[source] ?? source + 2;
    const cell = (field: RequestField) => {
      const column = mapping[field];
      return column === null ? '' : (cells[column] ?? '').trim();
    };
    const address = cell('address');
    if (!address) {
      skipped.push({ line, text: 'нет адреса' });
      return;
    }

    let start: string | null = null;
    let end: string | null = null;
    if (mapping.window !== null)
      ({ start, end } = parseWindowCell(cell('window')) ?? { start, end });
    if (!start && mapping.start !== null) start = parseClock(cell('start'));
    if (!end && mapping.end !== null) end = parseClock(cell('end'));
    if (!start || !end || start >= end) {
      const empty = !cell('window') && !cell('start') && !cell('end');
      notes.push({
        line,
        text: empty ? 'окна нет — весь день смены' : 'окно не распознано — весь день смены',
      });
      start = null;
      end = null;
    }

    let id = cell('id') || `R${String(source + 1).padStart(4, '0')}`;
    const repeats = seen.get(id) ?? 0;
    seen.set(id, repeats + 1);
    if (repeats > 0) {
      notes.push({ line, text: `номер ${id} повторяется — загрузим как ${id}-${repeats + 1}` });
      id = `${id}-${repeats + 1}`;
    }

    let lat: number | null = null;
    let lon: number | null = null;
    if (mapping.lat !== null && mapping.lon !== null && (cell('lat') || cell('lon'))) {
      lat = inRange(parseNumberCell(cell('lat')), 90);
      lon = inRange(parseNumberCell(cell('lon')), 180);
      if (lat === null || lon === null) {
        notes.push({ line, text: 'координаты не распознаны — найдём по адресу' });
        lat = null;
        lon = null;
      }
    }

    let duration: number | null = null;
    if (mapping.duration !== null && cell('duration')) {
      duration = parseDurationCell(cell('duration'));
      if (duration === null)
        notes.push({ line, text: 'длительность не распознана — по нормативу участка' });
    }

    let transport: Transport | null = null;
    if (mapping.transport !== null && cell('transport')) {
      transport = parseTransportCell(cell('transport'));
      if (transport === null)
        notes.push({ line, text: `транспорт не распознан — по правилу (${transportRuleText()})` });
    }

    rows.push({
      source,
      line,
      id,
      typeBk: cell('typeBk'),
      typeHd: cell('typeHd'),
      start,
      end,
      address,
      district: cell('district'),
      gigabit: parseBoolCell(cell('gigabit')) ?? false,
      technology: cell('technology'),
      transport,
      duration,
      lat,
      lon,
    });
  });
  return { rows, skipped, notes };
}

/** «окно не распознано — весь день смены: строки 3, 7» — одна строка на причину. */
export function groupNotes(notes: readonly RowNote[]): { text: string; lines: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const { line, text } of notes) groups.set(text, [...(groups.get(text) ?? []), line]);
  return [...groups].map(([text, lines]) => ({ text, lines }));
}

export interface ControlRead {
  /** Бригада по номеру строки файла заявок (`RequestRow.source`). */
  brigades: Map<number, string>;
  by: 'id' | 'order';
  /** Строк заявок, для которых нашлась бригада. */
  matched: number;
}

/**
 * Контрольное распределение → бригада у каждой заявки. По номеру заявки, если номера совпадают хотя
 * бы у половины; иначе по порядку строк (в файлах кейса номера в двух файлах разные) — тогда строк
 * должно быть поровну. Не сопоставить — текст ошибки.
 */
export function readControl(
  control: CsvTable,
  mapping: Mapping<ControlField>,
  requestsTable: CsvTable,
  requests: readonly RequestRow[],
): ControlRead | string {
  const brigadeColumn = mapping.brigade;
  if (brigadeColumn === null) return 'Выберите колонку «Бригада»';
  const brigadeOf = (cells: string[]) => (cells[brigadeColumn] ?? '').trim();

  const idColumn = mapping.id;
  if (idColumn !== null) {
    const byId = new Map<string, string>();
    for (const cells of control.rows) {
      const id = (cells[idColumn] ?? '').trim();
      if (id && !byId.has(id)) byId.set(id, brigadeOf(cells));
    }
    const found = requests.filter((row) => byId.has(row.id));
    if (found.length > 0 && found.length * 2 >= requests.length) {
      const brigades = new Map<number, string>();
      for (const row of found) {
        const brigade = byId.get(row.id);
        if (brigade) brigades.set(row.source, brigade);
      }
      return { brigades, by: 'id', matched: brigades.size };
    }
  }

  if (control.rows.length !== requestsTable.rows.length) {
    return `В контрольном файле ${control.rows.length} строк, в файле заявок — ${requestsTable.rows.length}, а номера заявок не совпадают: бригады не сопоставить`;
  }
  const brigades = new Map<number, string>();
  for (const row of requests) {
    const brigade = brigadeOf(control.rows[row.source] ?? []);
    if (brigade) brigades.set(row.source, brigade);
  }
  return { brigades, by: 'order', matched: brigades.size };
}
