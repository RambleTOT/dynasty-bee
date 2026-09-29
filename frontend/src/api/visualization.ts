/** Геометрия маршрутов для карты: [lon, lat] (FRONTEND_SPEC §6.6). */
import { api } from './client';
import type { GeoJsonCollection } from './types';

type Signal = AbortSignal | undefined;

export const getGeojson = (planId: string, signal?: Signal) =>
  api.get<GeoJsonCollection>(`/visualization/${planId}/geojson`, {
    query: { geometry: 'road' },
    signal,
  });
