/**
 * Подсказки адресов и адрес точки — Photon (OpenStreetMap), настройки — ADDRESS_SUGGEST в config.ts.
 * Ответ — GeoJSON как есть; разбор — adapters/address.ts.
 */
import { ADDRESS_SUGGEST } from '@/config';
import { fetchExternalJson } from './client';

export const addressSuggestEnabled = ADDRESS_SUGGEST.url !== null;

/**
 * Названия — на языке местности (для России — по-русски). Без параметра Photon отвечает на языке
 * браузера: в английском браузере офис сохранялся как «Moscow, Shabolovka Street», а улицы из
 * файла не совпадали с найденными.
 */
const LANG = 'default';

/** Подсказки по набранному тексту: Москва и область, ближе к центру — выше. */
export function suggestAddresses(query: string, signal?: AbortSignal): Promise<unknown> {
  if (!ADDRESS_SUGGEST.url) return Promise.resolve(null);
  const params = new URLSearchParams({
    q: query,
    lat: String(ADDRESS_SUGGEST.center.lat),
    lon: String(ADDRESS_SUGGEST.center.lon),
    bbox: ADDRESS_SUGGEST.bbox,
    limit: String(ADDRESS_SUGGEST.limit),
    lang: LANG,
  });
  return fetchExternalJson(`${ADDRESS_SUGGEST.url}/api/?${params}`, signal);
}

/** Адрес точки на карте. */
export function reverseAddress(lat: number, lon: number, signal?: AbortSignal): Promise<unknown> {
  if (!ADDRESS_SUGGEST.url) return Promise.resolve(null);
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    limit: '1',
    lang: LANG,
  });
  return fetchExternalJson(`${ADDRESS_SUGGEST.url}/reverse?${params}`, signal);
}

/**
 * Точка по адресу заявки (загрузка другого участка, §14): три варианта, ближе к офису — выше.
 * Выбор варианта — adapters/address.ts `geocodeHit`.
 */
export function geocodeAddress(
  query: string,
  near: { lat: number; lon: number } | null,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!ADDRESS_SUGGEST.url) return Promise.resolve(null);
  const params = new URLSearchParams({ q: query, limit: '3', lang: LANG });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lon));
  }
  return fetchExternalJson(`${ADDRESS_SUGGEST.url}/api/?${params}`, signal);
}
