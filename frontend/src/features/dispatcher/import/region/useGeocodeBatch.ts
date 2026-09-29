import { useCallback, useEffect, useRef, useState } from 'react';
import { geocodeHit, geocodeQuery, type GeocodeHit } from '@/adapters/address';
import type { Point } from '@/adapters/canonicalCsv';
import { geocodeAddress } from '@/api/geocoder';

export interface GeocodeItem {
  /** `RequestRow.source`. */
  source: number;
  address: string;
}

export interface GeocodeProgress {
  running: boolean;
  /** Адресов отправлено и получено (одинаковые адреса — один запрос). */
  done: number;
  total: number;
  finished: boolean;
}

const IDLE: GeocodeProgress = { running: false, done: 0, total: 0, finished: false };

/** Запросов к Photon одновременно: сервис общий, не нагружаем его. */
const PARALLEL = 3;

/**
 * Точки заявок другого участка по адресам (§14): Photon, по три запроса, одинаковый адрес — один
 * запрос. Запускает диспетчер кнопкой: адреса уходят в сторонний сервис.
 */
export function useGeocodeBatch() {
  const [hits, setHits] = useState<ReadonlyMap<number, GeocodeHit>>(new Map());
  const [missed, setMissed] = useState<readonly number[]>([]);
  const [progress, setProgress] = useState<GeocodeProgress>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (items: readonly GeocodeItem[], office: Point | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sourcesByQuery = new Map<string, number[]>();
    const lost: number[] = [];
    for (const { source, address } of items) {
      const query = geocodeQuery(address);
      if (!query) lost.push(source);
      else sourcesByQuery.set(query, [...(sourcesByQuery.get(query) ?? []), source]);
    }
    const queries = [...sourcesByQuery.keys()];
    const found = new Map<number, GeocodeHit>();
    let next = 0;
    let done = 0;
    setProgress({ running: true, done: 0, total: queries.length, finished: false });

    const worker = async () => {
      while (next < queries.length && !controller.signal.aborted) {
        const query = queries[next];
        next += 1;
        let hit: GeocodeHit | null = null;
        try {
          hit = geocodeHit(await geocodeAddress(query, office, controller.signal), query, office);
        } catch {
          if (controller.signal.aborted) return;
        }
        for (const source of sourcesByQuery.get(query) ?? []) {
          if (hit) found.set(source, hit);
          else lost.push(source);
        }
        done += 1;
        setProgress((prev) => ({ ...prev, done }));
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (controller.signal.aborted) return;
    setHits(found);
    setMissed(lost.sort((a, b) => a - b));
    setProgress({ running: false, done, total: queries.length, finished: true });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setHits(new Map());
    setMissed([]);
    setProgress(IDLE);
  }, []);

  return { hits, missed, progress, run, reset };
}
