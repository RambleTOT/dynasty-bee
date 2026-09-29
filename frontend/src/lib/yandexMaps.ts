/**
 * Ссылки на маршрут в Яндекс Картах (FRONTEND_SPEC §9.2 E-04, D-21): старт и точки через «~»,
 * не больше 20 точек, тип маршрута — по транспорту инженера. Открываем через
 * `<a target="_blank" rel="noopener">`.
 */
import type { Transport } from './statuses';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Параметр `rtt`: авто, общественный транспорт, пешком, велосипед. */
export const RTT: Record<Transport, string> = {
  car: 'auto',
  public_transport: 'mt',
  walk: 'pd',
  bike: 'bc',
};

/** Лимит точек маршрута в Яндекс Картах, вместе со стартом. */
export const YANDEX_MAX_POINTS = 20;

export function yandexRouteUrl(start: LatLon, points: LatLon[], transport: Transport): string {
  const pts = [start, ...points]
    .slice(0, YANDEX_MAX_POINTS)
    .map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`)
    .join('~');
  return `https://yandex.ru/maps/?rtext=${pts}&rtt=${RTT[transport]}`;
}
