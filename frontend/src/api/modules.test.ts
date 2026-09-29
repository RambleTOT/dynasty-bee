import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '@/config';
import { applyOperatorEmergency, cancelBooking, searchRequests } from './booking';
import { importBeeline } from './data';
import { postAction } from './engineer';
import { applyEvent } from './events';
import { checkExtendResource, extendResource, runPlan, type ExtraEngineer } from './planning';

const fetchMock = vi.fn<typeof fetch>();

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

function lastBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls.at(-1)?.[1];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(ok());
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('события диспетчера', () => {
  it('всегда apply: false и source: dispatcher; заявка — order_id', async () => {
    await applyEvent({
      type: 'order_cancelled',
      plan_id: 'P1',
      event_time: '12:30',
      order_id: '305838184',
      params: { reason: 'client_refused' },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/events/apply`);
    expect(lastBody()).toEqual({
      type: 'order_cancelled',
      plan_id: 'P1',
      event_time: '12:30',
      order_id: '305838184',
      params: { reason: 'client_refused' },
      source: 'dispatcher',
      apply: false,
    });
    expect(lastBody()).not.toHaveProperty('request_id');
  });
});

describe('авария оператора (⏳ 9.1)', () => {
  it('без plan_id и event_time, регион и комментарий — в params', async () => {
    await applyOperatorEmergency({
      regionId: 'east',
      comment: '',
      request: {
        id: 'U-X',
        duration_minutes: 80,
        window_start: '12:00',
        window_end: '22:00',
        priority: 'urgent',
        required_skill: 'emergency',
      },
    });
    const body = lastBody();
    expect(body).toMatchObject({
      type: 'urgent_order_added',
      source: 'operator',
      apply: false,
      params: { region_id: 'east' },
    });
    expect(body).not.toHaveProperty('plan_id');
    expect(body).not.toHaveProperty('event_time');
    expect(body.params).not.toHaveProperty('comment');
  });
});

describe('инженер', () => {
  it('действие без at', async () => {
    await postAction({ action: 'en_route', request_id: '305871402' });
    expect(lastBody()).toEqual({ action: 'en_route', request_id: '305871402' });
  });
});

describe('планирование', () => {
  it('«Построить план»: seed 42 и базовый вариант', async () => {
    await runPlan('S1');
    expect(lastBody()).toEqual({ scenario_id: 'S1', seed: 42, include_baseline: true });
  });

  const extra: ExtraEngineer = {
    id: 'EXTRA-1',
    name: 'Дополнительная бригада',
    skills: ['emergency'],
    transport: 'car',
    shift_start: '10:00',
    shift_end: '22:00',
    latitude: 55.7,
    longitude: 37.76,
    start_kind: 'office',
  };

  it('рекомендация по ресурсам — с бригадой-кандидатом, без применения (apply: false)', async () => {
    await extendResource('P1', ['1', '2'], extra);
    expect(lastBody()).toEqual({
      order_ids: ['1', '2'],
      option: 'add_engineer',
      params: { engineer: extra },
      apply: false,
    });
  });

  it('P1-5: расчёт без сохранения — /extend-resource/check', async () => {
    await checkExtendResource('P1', ['1'], extra);
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/planning/P1/extend-resource/check');
    expect(lastBody()).toEqual({ order_ids: ['1'], option: 'add_engineer', params: { engineer: extra } });
  });
});

describe('оператор', () => {
  it('поиск — только q, без region_id и date', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await searchRequests('Грайвороновская');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/booking/requests?q=');
    expect(url).not.toContain('region_id');
    expect(url).not.toContain('date=');
  });

  it('отмена: причина и комментарий; день заявки — в параметрах запроса', async () => {
    await cancelBooking('305857695', { reason: 'other', comment: 'Переезд' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/booking/requests/305857695/cancel`);
    expect(lastBody()).toEqual({ reason: 'other', comment: 'Переезд' });

    fetchMock.mockResolvedValueOnce(ok({}));
    await cancelBooking('10211', { reason: 'client_refused' }, { regionId: 'east', date: '2026-09-28' });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      `${API_URL}/booking/requests/10211/cancel?region_id=east&date=2026-09-28`,
    );
  });
});

describe('импорт CSV', () => {
  it('multipart: файл заявок, контрольный, регион и дата', async () => {
    const requestsFile = new File(['a;b'], 'east.csv');
    const controlFile = new File(['c;d'], 'control.csv');
    await importBeeline({ requestsFile, controlFile, regionId: 'east', date: '2026-09-28' });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get('requests_file')).toBeInstanceOf(File);
    expect(form.get('control_file')).toBeInstanceOf(File);
    expect(form.get('region_id')).toBe('east');
    expect(form.get('date')).toBe('2026-09-28');
  });
});
