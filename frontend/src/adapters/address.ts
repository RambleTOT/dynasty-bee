/**
 * Подсказки адресов (Photon, GeoJSON) → строки для поля адреса: «Тверская улица, 7» и ниже
 * «Москва, Тверской». В поле уходит полный адрес — его же найдёт геокодер бэка.
 */

export interface AddressSuggestion {
  id: string;
  /** Главная строка: улица и дом или название места. */
  title: string;
  /** Вторая строка: город, район. */
  subtitle: string;
  /** В поле адреса: «Москва, Тверская улица, 7». */
  value: string;
  lat: number;
  lon: number;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

function unique(parts: (string | null)[]): string[] {
  const out: string[] = [];
  for (const part of parts) if (part && !out.includes(part)) out.push(part);
  return out;
}

function suggestionOf(feature: unknown, index: number): AddressSuggestion | null {
  if (!isObject(feature) || !isObject(feature.properties) || !isObject(feature.geometry)) return null;
  const coords = feature.geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lon, lat] = coords.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const p = feature.properties;
  const name = text(p.name);
  const street = text(p.street);
  const house = text(p.housenumber);
  const city = text(p.city) ?? text(p.locality) ?? text(p.county) ?? text(p.state);
  const district = text(p.district);

  // дом: «Тверская улица, 7»; улица или место: название; название дома — во вторую строку
  const address = street ? unique([street, house]).join(', ') : unique([name, house]).join(', ');
  if (!address) return null;
  const place = street && name && name !== street ? name : null;
  return {
    id: `${text(p.osm_type) ?? ''}${String(p.osm_id ?? index)}`,
    title: address,
    subtitle: unique([city, district, place]).join(', '),
    value: unique([city, address]).join(', '),
    lat,
    lon,
  };
}

/** Ответ Photon → подсказки без повторов; мусор — пустой список. */
export function parseSuggestions(response: unknown): AddressSuggestion[] {
  if (!isObject(response) || !Array.isArray(response.features)) return [];
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  response.features.forEach((feature, index) => {
    const suggestion = suggestionOf(feature, index);
    if (!suggestion || seen.has(suggestion.value)) return;
    seen.add(suggestion.value);
    out.push(suggestion);
  });
  return out;
}

/**
 * Первый вариант адреса для события без выбранной подсказки: `found` — с координатами, `none` —
 * сервис ответил, но адреса нет, `unavailable` — сервис выключен или не ответил.
 */
export type AddressLookup =
  | { status: 'found'; suggestion: AddressSuggestion }
  | { status: 'none' }
  | { status: 'unavailable' };

export function lookupOf(response: unknown): AddressLookup {
  if (response === null || response === undefined) return { status: 'unavailable' };
  const [first] = parseSuggestions(response);
  return first ? { status: 'found', suggestion: first } : { status: 'none' };
}

// --- точки заявок другого участка (§14, `anyRegionEnabled`) ---

/** Квартира, офис, подъезд — геокодер по ним промахивается: «кв. 47» уводит на другой конец города. */
const ROOM_PART =
  /^(?:кв|квартира|оф|офис|пом|помещение|комн|комната|подъезд|под|эт|этаж)(?![а-яё])/iu;

/** Сокращение улицы в начале слова (`\b` с кириллицей не работает). */
const abbr = (source: string) => new RegExp(`(?<![а-яё])${source}\\s*`, 'giu');

const STREET_ABBR: [RegExp, string][] = [
  [abbr('ул\\.'), 'улица '],
  [abbr('пр-кт\\.?'), 'проспект '],
  [abbr('просп\\.'), 'проспект '],
  [abbr('б-р\\.?'), 'бульвар '],
  [abbr('проезд\\.'), 'проезд '],
  [abbr('пер\\.'), 'переулок '],
  [abbr('ш\\.'), 'шоссе '],
  [abbr('наб\\.'), 'набережная '],
  [abbr('пл\\.'), 'площадь '],
  [abbr('туп\\.'), 'тупик '],
  [abbr('мкр\\.?'), 'микрорайон '],
];

/**
 * Адрес из файла → запрос геокодеру: без квартиры и «д.», сокращения улиц полностью, «Город Москва»
 * → «Москва». «Город Москва, б-р.Чонгарский, д. 1 к 4, кв. 314» → «Москва, бульвар Чонгарский, 1 к4».
 */
export function geocodeQuery(address: string): string {
  return address
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !ROOM_PART.test(part))
    .map((part) => {
      let text = part.replace(/^(?:г\.?\s*)?город\s+/iu, '').replace(/^г\.\s*/iu, '');
      for (const [abbr, full] of STREET_ABBR) text = text.replace(abbr, full);
      return text
        .replace(/^(?:д\.?|дом)\s*(?=\d)/iu, '')
        .replace(/\s(?:к\.?|корп\.?|корпус)\s*(\d+)/giu, ' к$1')
        .replace(/\s(?:стр\.?|строение)\s*(\d+)/giu, ' с$1')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(Boolean)
    .join(', ');
}

/** Слова, которые названия улицы не задают: города, типы улиц, «дом». */
const COMMON_WORDS = new Set([
  'москва',
  'город',
  'область',
  'московская',
  'район',
  'поселение',
  'улица',
  'проспект',
  'бульвар',
  'проезд',
  'переулок',
  'шоссе',
  'набережная',
  'площадь',
  'тупик',
  'микрорайон',
  'деревня',
  'поселок',
  'посёлок',
  'село',
  'квартал',
  'корпус',
  'строение',
  'владение',
]);

const STREET_TYPE =
  /(?<![а-яё])(?:улица|проспект|бульвар|проезд|переулок|шоссе|набережная|площадь|тупик|микрорайон)(?![а-яё])/iu;

/**
 * Значимые слова улицы: «Москва, бульвар Чонгарский, 1 к4» → [«чонга»]. Часть с типом улицы, иначе
 * вторая часть (первая — обычно город: по ней совпадёт любая улица города).
 */
function nameStems(query: string): string[] {
  const parts = query.split(',').map((part) => part.trim());
  const street = parts.find((part) => STREET_TYPE.test(part)) ?? parts[1] ?? parts[0] ?? '';
  const words =
    street
      .toLowerCase()
      .replace(/ё/g, 'е')
      .match(/[а-яa-z]{3,}/gu) ?? [];
  return [
    ...new Set(words.filter((word) => !COMMON_WORDS.has(word)).map((word) => word.slice(0, 5))),
  ];
}

export type GeocodePrecision = 'house' | 'street';

export interface GeocodeHit {
  lat: number;
  lon: number;
  precision: GeocodePrecision;
  /** Что нашёл геокодер: «Чонгарский бульвар, 1 к4». */
  label: string;
}

/** Дальше этого от офиса — чужой город, не заявка участка. */
const MAX_OFFICE_KM = 100;

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Ответ Photon на `geocodeQuery` → точка. Берём первый вариант, у которого улица совпадает со словами
 * адреса: дом — точно, улица — «по улице». Остальное (город, район, чужая улица, дальше 100 км от
 * офиса) — не нашли.
 */
export function geocodeHit(
  response: unknown,
  query: string,
  office: { lat: number; lon: number } | null,
): GeocodeHit | null {
  if (!isObject(response) || !Array.isArray(response.features)) return null;
  const stems = nameStems(query);
  if (stems.length === 0) return null;
  for (const feature of response.features) {
    if (!isObject(feature) || !isObject(feature.properties) || !isObject(feature.geometry))
      continue;
    const coords = feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (office && distanceKm(office, { lat, lon }) > MAX_OFFICE_KM) continue;
    const p = feature.properties;
    const street = text(p.street) ?? (p.type === 'street' ? text(p.name) : null);
    if (!street) continue;
    const found = street.toLowerCase().replace(/ё/g, 'е');
    if (!stems.some((stem) => found.includes(stem))) continue;
    const house = text(p.housenumber);
    return {
      lat,
      lon,
      precision: house ? 'house' : 'street',
      label: unique([street, house]).join(', '),
    };
  }
  return null;
}
