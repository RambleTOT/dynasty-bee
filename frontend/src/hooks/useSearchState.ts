import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Один query-параметр: как прочитать его из адреса и как записать обратно. */
export interface SearchParamDef<T> {
  /** `raw === null` — параметра в адресе нет. */
  parse(raw: string | null): T;
  /** `null` — убрать параметр из адреса (значение по умолчанию или пустое). */
  serialize(value: T): string | null;
}

export type SearchSchema = Record<string, SearchParamDef<unknown>>;

export type SearchValues<S extends SearchSchema> = {
  [K in keyof S]: S[K] extends SearchParamDef<infer T> ? T : never;
};

export type SearchPatch<S extends SearchSchema> = Partial<SearchValues<S>>;

function stringParam(): SearchParamDef<string | null>;
function stringParam(fallback: string): SearchParamDef<string>;
function stringParam(fallback: string | null = null): SearchParamDef<string | null> {
  return {
    parse: (raw) => (raw === null || raw === '' ? fallback : raw),
    serialize: (value) => (value === null || value === '' || value === fallback ? null : value),
  };
}

function numberParam(): SearchParamDef<number | null>;
function numberParam(fallback: number): SearchParamDef<number>;
function numberParam(fallback: number | null = null): SearchParamDef<number | null> {
  return {
    parse: (raw) => {
      if (raw === null || raw.trim() === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    },
    serialize: (value) =>
      value === null || !Number.isFinite(value) || value === fallback ? null : String(value),
  };
}

function enumParam<const V extends string>(values: readonly V[]): SearchParamDef<V | null>;
function enumParam<const V extends string>(values: readonly V[], fallback: V): SearchParamDef<V>;
function enumParam<const V extends string>(
  values: readonly V[],
  fallback: V | null = null,
): SearchParamDef<V | null> {
  const allowed = new Set<string>(values);
  return {
    parse: (raw) => (raw !== null && allowed.has(raw) ? (raw as V) : fallback),
    serialize: (value) => (value === null || value === fallback ? null : value),
  };
}

function listParam(): SearchParamDef<string[]>;
function listParam<const V extends string>(values: readonly V[]): SearchParamDef<V[]>;
function listParam(values?: readonly string[]): SearchParamDef<string[]> {
  const allowed = values ? new Set(values) : null;
  return {
    parse: (raw) => {
      const items = (raw ?? '').split(',').map((item) => item.trim());
      return [...new Set(items)].filter((item) => item !== '' && (!allowed || allowed.has(item)));
    },
    serialize: (value) => (value.length ? value.join(',') : null),
  };
}

/**
 * Описания параметров для `useSearchState`. Без значения по умолчанию — `null` (список — `[]`).
 * Значение по умолчанию в адрес не пишется.
 */
export const searchParam = {
  string: stringParam,
  number: numberParam,
  enum: enumParam,
  list: listParam,
};

export function parseSearch<S extends SearchSchema>(
  schema: S,
  params: URLSearchParams,
): SearchValues<S> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(schema)) values[key] = schema[key].parse(params.get(key));
  return values as SearchValues<S>;
}

/**
 * Типизированные query-параметры страницы: фильтры и открытые панели (docs/ARCHITECTURE.md).
 *
 * ```ts
 * const daySearch = { view: searchParam.enum(['map', 'timeline'], 'map'), request: searchParam.string() };
 * const [search, setSearch] = useSearchState(daySearch); // схему объявлять вне компонента
 * setSearch({ request: 'R-1' });                          // открыть DS-04
 * setSearch({ request: null });                           // закрыть
 * ```
 *
 * Запись — с `replace: true` (история браузера не копится). Параметры вне схемы сохраняются.
 * Запись строится от последнего адреса, а не от того, что был при отрисовке: вызовы подряд
 * складываются, а замыкание после `await` не вернёт закрытые с тех пор панели.
 */
export function useSearchState<S extends SearchSchema>(schema: S) {
  const [searchParams, setSearchParams] = useSearchParams();
  // `setSearchParams(prev => …)` роутера берёт адрес отрисовки: два вызова до новой отрисовки
  // затирают друг друга. Последний адрес — наш: из роутера, когда он сменился, или из записи.
  const latest = useRef(searchParams);
  const seen = useRef(searchParams);
  if (seen.current !== searchParams) {
    seen.current = searchParams;
    latest.current = searchParams;
  }

  const values = useMemo(() => parseSearch(schema, searchParams), [schema, searchParams]);

  const setValues = useCallback(
    (patch: SearchPatch<S> | ((current: SearchValues<S>) => SearchPatch<S>)) => {
      const next = new URLSearchParams(latest.current);
      const changes = typeof patch === 'function' ? patch(parseSearch(schema, next)) : patch;
      for (const key of Object.keys(changes)) {
        const value = changes[key];
        const raw = value === undefined ? null : schema[key].serialize(value);
        if (raw === null) next.delete(key);
        else next.set(key, raw);
      }
      latest.current = next;
      setSearchParams(next, { replace: true });
    },
    [schema, setSearchParams],
  );

  return [values, setValues] as const;
}
