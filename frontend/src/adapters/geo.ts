/**
 * Геометрия карты (FRONTEND_SPEC §6.6): линии — из GeoJSON плана (`[lon, lat]`), при его отсутствии
 * или на условных координатах синтетики — прямые отрезки старт → точки по `sequence`.
 */
import type { GeoJsonCollection } from '@/api/types';
import { isValidLatLng, type LatLng } from '@/lib/map';
import type { DayModel, DayRoute } from './dayModel';

export interface RouteLine {
  engineerId: string;
  points: LatLng[];
  /** Линия по дорогам (иначе — прямые отрезки). */
  road: boolean;
}

function straight(route: DayRoute): RouteLine | null {
  const points = [route.start, ...route.visits.map((v) => v.point)].filter((p): p is LatLng => Boolean(p));
  return points.length >= 2 ? { engineerId: route.engineerId, points, road: false } : null;
}

function lineCoords(geometry: { type: string; coordinates: unknown } | null): LatLng[] {
  if (!geometry) return [];
  const toLatLng = (pair: unknown): LatLng | null => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [lon, lat] = pair as [number, number];
    return isValidLatLng(lat, lon) ? [lat, lon] : null;
  };
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map(toLatLng).filter((p): p is LatLng => Boolean(p));
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as unknown[])
      .flatMap((line) => (Array.isArray(line) ? line : []))
      .map(toLatLng)
      .filter((p): p is LatLng => Boolean(p));
  }
  return [];
}

export function routeLines(
  model: Pick<DayModel, 'routes' | 'coordsApprox'>,
  geojson: GeoJsonCollection | null | undefined,
): RouteLine[] {
  const fallback = () => model.routes.map(straight).filter((l): l is RouteLine => Boolean(l));
  // синтетика: дорожную геометрию не берём (§6.8)
  if (model.coordsApprox || !geojson?.features?.length) return fallback();

  const byEngineer = new Map<string, RouteLine>();
  for (const feature of geojson.features) {
    const props = feature.properties ?? {};
    if (props.feature_type !== 'route' && feature.geometry?.type !== 'LineString') continue;
    const engineerId = typeof props.engineer_id === 'string' ? props.engineer_id : null;
    if (!engineerId) continue;
    const points = lineCoords(feature.geometry);
    if (points.length < 2) continue;
    const source = String(props.geometry_source ?? '');
    byEngineer.set(engineerId, { engineerId, points, road: !source.startsWith('straight') });
  }
  if (byEngineer.size === 0) return fallback();
  // бригаде с визитами, но без линии в GeoJSON — прямые отрезки
  for (const route of model.routes) {
    if (byEngineer.has(route.engineerId) || route.visits.length === 0) continue;
    const line = straight(route);
    if (line) byEngineer.set(route.engineerId, line);
  }
  return [...byEngineer.values()];
}

/** Нужна подпись «линия — по дорогам, время — по типу транспорта»: есть не-авто бригады в маршрутах. */
export function hasNonCarRoutes(model: Pick<DayModel, 'engineers'>): boolean {
  return model.engineers.some((e) => e.used && e.transport !== 'car');
}

/** Рамка для fitBounds: все точки дня. */
export function dayBounds(model: Pick<DayModel, 'requests' | 'engineers' | 'office'>): LatLng[] {
  const points: LatLng[] = [];
  for (const r of model.requests) if (r.point) points.push(r.point);
  for (const e of model.engineers) if (e.start) points.push(e.start);
  if (model.office) points.push(model.office.point);
  return points;
}
