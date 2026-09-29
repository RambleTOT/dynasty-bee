import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStorage } from '@/auth/tokenStorage';
import { API_URL } from '@/config';
import { api, buildUrl, UNAUTHORIZED_EVENT } from './client';
import { ApiError } from './errors';

const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url, init: init ?? {}, headers: new Headers(init?.headers) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('request', () => {
  it('с токеном — заголовок Authorization: Bearer', async () => {
    tokenStorage.set('token-1');
    fetchMock.mockResolvedValue(json({ id: 'u1' }));

    await expect(api.get('/auth/me')).resolves.toEqual({ id: 'u1' });
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${API_URL}/auth/me`);
    expect(init.method).toBe('GET');
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('без токена — без Authorization', async () => {
    fetchMock.mockResolvedValue(json([]));
    await api.get('/regions');
    expect(lastCall().headers.has('Authorization')).toBe(false);
  });

  it('json — тело строкой и Content-Type: application/json', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await api.post('/auth/login', { login: 'dispatcher', password: 'x' });
    const { init, headers } = lastCall();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"login":"dispatcher","password":"x"}');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('form — FormData без Content-Type (boundary ставит браузер)', async () => {
    fetchMock.mockResolvedValue(json({ scenario_id: 's1' }));
    const form = new FormData();
    form.append('region_id', 'east');
    await api.postForm('/data/import-beeline', form);
    const { init, headers } = lastCall();
    expect(init.body).toBe(form);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('204 → undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('401 с токеном → событие auth:unauthorized и ApiError', async () => {
    tokenStorage.set('expired');
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    fetchMock.mockResolvedValue(
      json({ error: { code: 'UNAUTHORIZED', message: 'Токен истёк' } }, 401),
    );

    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('401 без токена (неверный пароль) — без события', async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    fetchMock.mockResolvedValue(
      json({ error: { code: 'UNAUTHORIZED', message: 'Неверный логин или пароль' } }, 401),
    );

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({
      status: 401,
      message: 'Неверный логин или пароль',
    });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('ошибка с не-JSON телом → ApiError UNKNOWN', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    const error = await api.get('/regions').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('сетевая ошибка → ApiError(0, NETWORK)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.get('/regions')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK',
      message: 'Не удалось связаться с сервером. Повторите',
    });
  });

  it('отмена запроса — исходная AbortError, а не NETWORK', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(api.get('/regions', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('buildUrl', () => {
  it('пропускает undefined и null, массивы — через запятую', () => {
    const url = buildUrl('/calendar', {
      from: '2026-09-01',
      region_id: undefined,
      status: ['planned', 'done'],
      flag: null,
      limit: 0,
    });
    expect(url).toBe(`${API_URL}/calendar?from=2026-09-01&status=planned%2Cdone&limit=0`);
  });

  it('без query — без «?»', () => {
    expect(buildUrl('/regions')).toBe(`${API_URL}/regions`);
  });
});
