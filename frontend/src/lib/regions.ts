/**
 * Подписи участков. Три участка кейса — в справочнике (`REGION_LABEL`): подпись есть и до ответа
 * `GET /regions`. Свои участки (§14) приходят только с бэка — их названия запоминаем из ответа
 * (hooks/useRegions.ts).
 */
import { FEATURES } from '@/config';
import { REGION_LABEL, REGIONS } from './statuses';

const learned = new Map<string, string>();
/** Бэк отдаёт в `GET /regions` поле `builtin` — значит, §14 выложен: свои участки можно заводить. */
let backendRegions = false;

export function rememberRegions(
  regions: readonly { region_id: string; name: string; builtin?: unknown }[],
): void {
  for (const { region_id: id, name } of regions) {
    if (id && name?.trim()) learned.set(id, name.trim());
  }
  if (regions.some((region) => typeof region.builtin === 'boolean')) backendRegions = true;
}

/** Только для тестов: забыть названия и признак §14 с бэка. */
export function forgetRegions(): void {
  learned.clear();
  backendRegions = false;
}

/**
 * Свои участки (§14): флаг `FEATURES.anyRegion` или бэк уже умеет (в `GET /regions` есть `builtin`).
 * Фронт включает «Другой участок» сам, как только бэк выложит §14, — без новой сборки.
 */
export const anyRegionEnabled = (): boolean => FEATURES.anyRegion || backendRegions;

export const isBuiltinRegion = (id: string): boolean => (REGIONS as readonly string[]).includes(id);

/** Название участка: с бэка, иначе справочник; незнакомый участок — `null`. */
export function knownRegionName(id: string | null | undefined): string | null {
  if (!id) return null;
  return (
    learned.get(id) ?? (isBuiltinRegion(id) ? REGION_LABEL[id as keyof typeof REGION_LABEL] : null)
  );
}

/** id участка в адресе: латиница, цифры, «_» и «-» — id своих участков выдаёт бэк (§14). */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
export const isRegionSlug = (value: unknown): value is string =>
  typeof value === 'string' && SLUG.test(value);
