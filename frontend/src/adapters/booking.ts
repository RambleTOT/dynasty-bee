/**
 * Модели оператора из ответов /booking/* (FRONTEND_SPEC §8.3.4). Поиск, отмена и перенос в схеме
 * нетипизированы, поля ⏳ 9.2, 9.4, 9.5, 9.7 могут не прийти — читаем только безопасно.
 */
import type { BookingSearchItem, BookingSlotsResponse, SlotOut } from '@/api/types';
import { skillLabel } from '@/lib/dictionaries';
import { isRequestStatus, isTransport, type RequestStatus, type Transport } from '@/lib/statuses';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;
/** Номер заявки: строка, а если бэк прислал число — тоже строка. */
const idOf = (value: unknown): string | undefined =>
  text(value) ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined);

/** Заявка из поиска оператора. Компоненты читают только эту модель. */
export interface BookingItem {
  id: string;
  regionId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** '18:00-20:00' */
  window: string;
  /** Пусто — адреса нет. */
  address: string;
  typeBk: string;
  typeHd?: string;
  /** Незнакомый статус — `null`, чип не рисуем. */
  status: RequestStatus | null;
  /** ⏳ 9.2 — нет поля: `undefined`, строку в карточке не выводим. */
  district?: string;
  gigabit?: boolean;
  technology?: string;
  /** ⏳ 9.2 — `null`: транспорт не требуется. */
  requiredTransport?: Transport | null;
  /** ⏳ 9.2 — `null`: инженер не назначен («не назначен»). */
  engineerName?: string | null;
}

export function normalizeSearchItem(raw: BookingSearchItem | Json): BookingItem {
  const row: Json = isObject(raw) ? (raw as unknown as Json) : {};
  const item: BookingItem = {
    id: idOf(row.request_id) ?? '',
    regionId: text(row.region_id) ?? '',
    date: text(row.date) ?? '',
    window: text(row.window) ?? '',
    address: text(row.address) ?? '',
    typeBk: text(row.type_bk) ?? '',
    status: isRequestStatus(row.status) ? row.status : null,
  };
  const typeHd = text(row.type_hd);
  if (typeHd) item.typeHd = typeHd;
  const district = text(row.district);
  if (district) item.district = district;
  if (typeof row.gigabit === 'boolean') item.gigabit = row.gigabit;
  const technology = text(row.technology);
  if (technology) item.technology = technology;
  if ('required_transport' in row) {
    item.requiredTransport = isTransport(row.required_transport) ? row.required_transport : null;
  }
  if ('engineer_name' in row) item.engineerName = text(row.engineer_name) ?? null;
  return item;
}

/** Новые сверху [Д]: по дате, внутри даты — по окну. Без даты — в конце. */
function byDateDesc(a: BookingItem, b: BookingItem): number {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  }
  if (a.window !== b.window) return a.window < b.window ? 1 : -1;
  return a.id.localeCompare(b.id);
}

/**
 * Заявка поиска — номер, регион и день: номера повторяются в разных днях и регионах (запись
 * оператора BK-0001, демо-наборы), поэтому выбор и переходы — по всем трём.
 */
export interface BookingRef {
  id: string;
  regionId?: string | null;
  date?: string | null;
}

/** Ключ строки поиска и выбора. */
export const bookingKey = (item: BookingRef) =>
  `${item.id}|${item.regionId ?? ''}|${item.date ?? ''}`;

/**
 * Что спросить у бэка по строке поиска. Бэк ищет номер по началу (`startswith`), а адрес — по
 * вхождению (BACKEND_REQUESTS п. 42), поэтому:
 * - «ВК-2026…» русскими буквами → «BK-2026…»;
 * - цифры без приставки («20260930-0001», «202609») — ещё и как номер записи «BK-…».
 * Ответы нескольких запросов склеивает `normalizeSearch` (одна строка на заявку дня).
 */
export function searchQueries(raw: string): string[] {
  const q = raw.trim().replace(/^[ВвBb][КкKk](?=[\s-]*\d)[\s-]*/, 'BK-');
  const queries = [q];
  if (/^\d[\d-]{2,}$/.test(q)) queries.push(`BK-${q}`);
  return queries;
}

/**
 * Ответ GET /booking/requests → строки поиска, новые сверху. Одна строка на заявку дня: бэк отдаёт
 * и архивные копии того же дня (BACKEND_REQUESTS п. 27) — оставляем первую, из самого нового дня.
 */
export function normalizeSearch(
  raw: readonly BookingSearchItem[] | null | undefined,
): BookingItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(isObject)
    .map(normalizeSearchItem)
    .filter((item) => {
      const key = bookingKey(item);
      if (item.id === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(byDateDesc);
}

/**
 * Заявка с этим номером (точное совпадение — поиск по номеру ищет по префиксу), а если известны
 * регион и день — именно в этом дне.
 */
export function findExact(
  items: readonly BookingItem[] | undefined,
  id: string | null,
  where: { regionId?: string | null; date?: string | null } = {},
) {
  if (!id) return undefined;
  return items?.find(
    (item) =>
      item.id === id &&
      (!where.regionId || item.regionId === where.regionId) &&
      (!where.date || item.date === where.date),
  );
}

// --- окна ---

export interface SlotView {
  /** '14:00-16:00' — как в ответе, так же уходит в запись. */
  window: string;
  available: boolean;
}

export interface SlotsModel {
  /** Подпись навыка по словарю (§10.1) для строки «Навык: … · N мин на адресе»; пусто — строки нет. */
  skill: string;
  duration: number | null;
  /** ⏳ 9.7: район по адресу. */
  district?: string;
  slots: SlotView[];
}

function toSlots(raw: unknown): SlotView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((slot) => ({ window: text(slot.window) ?? '', available: slot.available === true }))
    .filter((slot) => slot.window !== '');
}

/** Ответ GET /booking/slots. Окна — как пришли, 6 окон не зашиваем. */
export function normalizeSlots(raw: BookingSlotsResponse): SlotsModel {
  const row: Json = isObject(raw) ? (raw as unknown as Json) : {};
  const skill = text(row.required_skill);
  const duration = row.duration_minutes;
  const model: SlotsModel = {
    skill: skill ? skillLabel(skill) : '',
    duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
    slots: toSlots(row.slots),
  };
  const district = text(row.district);
  if (district) model.district = district;
  return model;
}

/** Выбранное окно ещё можно взять. */
export function isSlotFree(slots: readonly SlotView[], window: string): boolean {
  return slots.some((slot) => slot.window === window && slot.available);
}

/** ⏳ 9.5: свежие окна в `error.details.slots` при 409 SLOT_TAKEN; нет — `null` (перезапрос). */
export function slotsFromError(details: unknown): SlotOut[] | null {
  if (!isObject(details) || !Array.isArray(details.slots)) return null;
  const slots = toSlots(details.slots);
  return slots.length ? slots : null;
}

// --- ответы записи, отмены, переноса ---

/** ⏳ 9.4: `message` и новые `request_id`, `date`, `window` — если пришли. */
export interface BookingOutcome {
  status?: string;
  message?: string;
  requestId?: string;
  date?: string;
  window?: string;
}

export function normalizeOutcome(raw: unknown): BookingOutcome {
  if (!isObject(raw)) return {};
  const outcome: BookingOutcome = {};
  const status = text(raw.status);
  if (status) outcome.status = status;
  const message = text(raw.message);
  // «16:00-18:00» в тексте бэка → «16:00–18:00», как в остальном интерфейсе
  if (message) outcome.message = message.replace(/(\d{1,2}:\d{2})\s?-\s?(\d{1,2}:\d{2})/g, '$1–$2');
  const requestId = idOf(raw.request_id);
  if (requestId) outcome.requestId = requestId;
  const date = text(raw.date);
  if (date) outcome.date = date;
  const window = text(raw.window);
  if (window) outcome.window = window;
  return outcome;
}
