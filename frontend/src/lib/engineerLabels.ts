/**
 * Подписи экрана инженера (FRONTEND_SPEC §9.1, §10.1, D-32): заголовок заявки, номер, адрес, окно.
 * В строках — коротко, в карточках — полностью.
 */
import { shortId, typeBkOrSkill } from './dictionaries';
import { plural } from './format';
import { parseWindow } from './time';

/** Адреса нет (синтетика, §6.8) — подпись серым. */
export const ADDRESS_MISSING = 'Адрес не указан';

const text = (value: string | null | undefined): string => (value ?? '').trim();

/** Поля визита, из которых собирается заголовок. `required_skill` в схеме визита нет — читаем, если пришло. */
export interface VisitTitleSource {
  type_hd?: string | null;
  type_bk?: string | null;
  required_skill?: string | null;
}

/** Заголовок заявки: `type_hd ?? type_bk ?? подпись по навыку` (§6.8); совсем ничего — «Заявка». */
export function visitTitle(visit: VisitTitleSource): string {
  return (
    text(visit.type_hd) || typeBkOrSkill(text(visit.type_bk), visit.required_skill) || 'Заявка'
  );
}

/** Номер в карточке: «№305871402». */
export const requestNo = (id: string): string => `№${id}`;

/** Номер в строке: «№…1402» (короткие id вида «T012» — целиком). */
export const requestNoShort = (id: string): string => `№${shortId(id)}`;

const CITY_PREFIX = /^\s*(?:город|г\.?)\s*Москва\s*,\s*/i;
const APARTMENT = /(?:\s*,\s*|\s+)(?:кв\.?|квартира)\s*\d.*$/i;

/** Адрес для карточки: без «Город Москва, », квартира остаётся (как в макете). */
export function fullAddress(address: string | null | undefined): string {
  return text(address).replace(CITY_PREFIX, '').trim();
}

/** Адрес для строк: без «Город Москва, » и без квартиры. */
export function shortAddress(address: string | null | undefined): string {
  return fullAddress(address).replace(APARTMENT, '').trim();
}

/** '14:00' → '14', '09:30' → '9:30'. */
function hourShort(time: string): string {
  const [hours, minutes] = time.split(':');
  const hour = String(Number(hours));
  return minutes === '00' ? hour : `${hour}:${minutes}`;
}

/** Окно в строках: '14:00-16:00' → «14–16». Не окно — как пришло. */
export function windowShort(window: string | null | undefined): string {
  const parsed = parseWindow(text(window));
  return parsed ? `${hourShort(parsed.start)}–${hourShort(parsed.end)}` : text(window);
}

/** Окно в карточке: '14:00-16:00' → «14:00–16:00». Не окно — как пришло. */
export function windowFull(window: string | null | undefined): string {
  const parsed = parseWindow(text(window));
  return parsed ? `${parsed.start}–${parsed.end}` : text(window);
}

/** Длительность визита — в минутах, как в макете: «70 мин». */
export const durationLabel = (minutes: number): string => `${Math.round(minutes)} мин`;

/** Подтверждение «Завершить смену» (§9.2): «Осталось 3 заявки. Они вернутся диспетчеру». */
export function shiftEndWarning(count: number): string {
  const one = plural(count, ['one', 'few', 'many']) === 'one';
  const left = `${one ? 'Осталась' : 'Осталось'} ${count} ${plural(count, ['заявка', 'заявки', 'заявок'])}`;
  return `${left}. ${one ? 'Она вернётся' : 'Они вернутся'} диспетчеру`;
}
