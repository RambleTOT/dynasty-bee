import { describe, expect, it } from 'vitest';
import { realtimeUrl } from './realtime';

describe('адрес сокета живых обновлений', () => {
  it('API на том же сайте — хост страницы, wss для https', () => {
    const page = { protocol: 'https:', host: 'bee-dynasty.ru:8443' };
    expect(realtimeUrl('t-1', null, '/api/v1', page)).toBe(
      'wss://bee-dynasty.ru:8443/api/v1/realtime/ws?ticket=t-1',
    );
    expect(realtimeUrl('t 2', 57, '/api/v1', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/v1/realtime/ws?ticket=t+2&since=57',
    );
  });

  it('API на своём домене — его хост', () => {
    expect(realtimeUrl('t', 3, 'https://api.bee-dynasty.ru/api/v1')).toBe(
      'wss://api.bee-dynasty.ru/api/v1/realtime/ws?ticket=t&since=3',
    );
  });
});
