/** Общие настройки карт (Leaflet): тайлы OSM, центр Москвы по умолчанию (FRONTEND_SPEC §2, §6.8). */
export const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
} as const;

/** Центр Москвы — если у региона нет офиса (§6.8). */
export const MOSCOW_CENTER: [number, number] = [55.751, 37.618];

export type LatLng = [number, number];

/** Точка пригодна для карты: числа в пределах широты/долготы. */
export function isValidLatLng(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}
