import { tokenStorage } from '@/auth/tokenStorage';
import { API_URL } from '@/config';
import { ApiError, toApiError } from './errors';

/** Бэк ответил 401 на запрос с токеном — сессия истекла. Слушает AuthProvider. */
export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

type QueryScalar = string | number | boolean;
export type QueryParams = Record<string, QueryScalar | readonly QueryScalar[] | null | undefined>;

export interface RequestOptions {
  query?: QueryParams;
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

/** DELETE-ручки не используем (правила проекта), поэтому такого метода нет. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT';

/** URL = API_URL + path + query. `undefined` и `null` пропускаем, массивы — через запятую. */
export function buildUrl(path: string, query?: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    params.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const search = params.toString();
  return `${API_URL}${path}${search ? `?${search}` : ''}`;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const networkError = () => new ApiError(0, 'NETWORK', 'Не удалось связаться с сервером. Повторите');

export async function request<T>(
  method: HttpMethod,
  path: string,
  { query, json, form, signal }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  const token = tokenStorage.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let body: BodyInit | undefined;
  if (form) {
    body = form; // Content-Type с boundary выставит браузер
  } else if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }

  let response: Response;
  let text: string;
  try {
    response = await fetch(buildUrl(path, query), { method, headers, body, signal });
    text = response.status === 204 ? '' : await response.text();
  } catch (error) {
    if (signal?.aborted) throw error; // отмену (react-query, уход со страницы) не выдаём за сбой сети
    throw networkError();
  }

  if (!response.ok) {
    // 401 без токена — это неверный логин или пароль, а не истёкшая сессия.
    if (response.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw toApiError(response.status, parseBody(text));
  }
  return parseBody(text) as T;
}

/**
 * Главная страница сайта без кэша — сверить номер сборки (app/useNewVersion.ts). Не API: без
 * токена и без разбора ошибок; не вышло — `null`.
 */
export async function fetchSiteIndex(): Promise<string | null> {
  try {
    const response = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * JSON стороннего сервиса (подсказки адресов, api/geocoder.ts). Не наш API: без токена и cookies,
 * без разбора ошибок бэка; не вышло — `null`. Отмену (`signal`) не глотаем.
 */
export async function fetchExternalJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  if (!response.ok) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

type Options = Pick<RequestOptions, 'query' | 'signal'>;

export const api = {
  get: <T>(path: string, options?: Options) => request<T>('GET', path, options),
  post: <T>(path: string, json?: unknown, options?: Options) =>
    request<T>('POST', path, { ...options, json }),
  patch: <T>(path: string, json?: unknown, options?: Options) =>
    request<T>('PATCH', path, { ...options, json }),
  put: <T>(path: string, json?: unknown, options?: Options) =>
    request<T>('PUT', path, { ...options, json }),
  postForm: <T>(path: string, form: FormData, options?: Options) =>
    request<T>('POST', path, { ...options, form }),
};
