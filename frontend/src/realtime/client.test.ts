import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { CLOSE, RealtimeClient, type RealtimeStatus, type SocketLike } from './client';
import type { RealtimeEvent } from './protocol';

/** Поддельный сокет: сообщения сервера — `receive`, закрытие со стороны сервера — `drop`. */
class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  closed: { code?: number; reason?: string } | null = null;
  constructor(readonly url: string) {}
  open() {
    this.onopen?.({});
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.onclose?.({ code: code ?? 1000, reason });
  }
}

const event = (seq: number, kind = 'plan.applied') => ({
  type: 'event',
  seq,
  kind,
  region_id: 'east',
  date: '2026-09-29',
  data: {},
});

function setup(getTicket = vi.fn(async () => 'ticket-1')) {
  const sockets: FakeSocket[] = [];
  const events: RealtimeEvent[] = [];
  const statuses: RealtimeStatus[] = [];
  const onResync = vi.fn();
  const client = new RealtimeClient({
    getTicket,
    url: (ticket, since) =>
      `wss://site/ws?ticket=${ticket}${since === null ? '' : `&since=${since}`}`,
    onEvent: (e) => events.push(e),
    onResync,
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5, // без разброса: паузы ровно 1 с, 2 с, 5 с…
  });
  return { client, sockets, events, statuses, onResync, getTicket };
}

/** Дать отработать промисам (билет) и таймерам до `ms`. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RealtimeClient', () => {
  it('билет → сокет → hello → события; повтор по seq пропускаем', async () => {
    const { client, sockets, events, statuses } = setup();
    client.start();
    await tick();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://site/ws?ticket=ticket-1');
    sockets[0].open();
    sockets[0].receive({ type: 'hello', protocol: 1, seq: 10, resumed: false });
    expect(client.currentStatus).toBe('open');
    sockets[0].receive(event(11));
    sockets[0].receive(event(11));
    sockets[0].receive(event(12, 'clock.changed'));
    expect(events.map((e) => [e.seq, e.kind])).toEqual([
      [11, 'plan.applied'],
      [12, 'clock.changed'],
    ]);
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('обрыв → пауза 1 с → новый билет и since; сервер повторил пропущенное', async () => {
    const getTicket = vi.fn(async () => `ticket-${getTicket.mock.calls.length}`);
    const { client, sockets, events, onResync } = setup(getTicket);
    client.start();
    await tick();
    sockets[0].receive({ type: 'hello', seq: 10, resumed: false });
    sockets[0].receive(event(11));
    sockets[0].drop();
    expect(client.currentStatus).toBe('reconnecting');
    await tick(999);
    expect(sockets).toHaveLength(1);
    await tick(1);
    expect(sockets[1].url).toBe('wss://site/ws?ticket=ticket-2&since=11');
    sockets[1].receive({ type: 'hello', seq: 13, resumed: true });
    sockets[1].receive(event(12));
    sockets[1].receive(event(13));
    expect(events.map((e) => e.seq)).toEqual([11, 12, 13]);
    expect(onResync).not.toHaveBeenCalled();
  });

  it('сервер перезапустился: номер меньше нашего, хотя resumed: true — обновить всё и считать заново', async () => {
    const { client, sockets, events, onResync } = setup();
    client.start();
    await tick();
    sockets[0].receive({ type: 'hello', seq: 40, resumed: false });
    sockets[0].receive(event(41));
    sockets[0].drop();
    await tick(1000);
    sockets[1].receive({ type: 'hello', seq: 0, resumed: true });
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(client.lastEventSeq).toBe(0);
    sockets[1].receive(event(1));
    expect(events.map((e) => e.seq)).toEqual([41, 1]);
  });

  it('сервер не повторил пропущенное (resumed: false) или прислал resync — обновить всё', async () => {
    const { client, sockets, onResync } = setup();
    client.start();
    await tick();
    sockets[0].receive({ type: 'hello', seq: 10, resumed: false });
    sockets[0].drop();
    await tick(1000);
    sockets[1].receive({ type: 'hello', seq: 25, resumed: false });
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(client.lastEventSeq).toBe(25);
    sockets[1].receive({ type: 'resync' });
    expect(onResync).toHaveBeenCalledTimes(2);
  });

  it('паузы растут: 1 с, 2 с, 5 с; после hello — снова с 1 с', async () => {
    const { client, sockets } = setup();
    client.start();
    await tick();
    sockets[0].drop();
    await tick(1000);
    sockets[1].drop();
    await tick(1999);
    expect(sockets).toHaveLength(2);
    await tick(1);
    sockets[2].drop();
    await tick(5000);
    expect(sockets).toHaveLength(4);
    sockets[3].receive({ type: 'hello', seq: 1, resumed: false });
    sockets[3].drop();
    await tick(1000);
    expect(sockets).toHaveLength(5);
  });

  it('сервер молчит дольше минуты — закрываем и переподключаемся', async () => {
    const { client, sockets } = setup();
    client.start();
    await tick();
    sockets[0].open();
    sockets[0].receive({ type: 'hello', seq: 1, resumed: false });
    await tick(59_000);
    sockets[0].receive({ type: 'ping' });
    await tick(59_000);
    expect(sockets[0].closed).toBeNull();
    await tick(1_000);
    expect(sockets[0].closed).toEqual({ code: CLOSE.heartbeat, reason: 'heartbeat' });
    await tick(1_000);
    expect(sockets).toHaveLength(2);
  });

  it('у бэка нет ручки билета (404) или роли не положено (4403) — unavailable, без повторов', async () => {
    const missing = setup(vi.fn(async () => Promise.reject(new ApiError(404, 'NOT_FOUND', 'нет'))));
    missing.client.start();
    await tick(60_000);
    expect(missing.client.currentStatus).toBe('unavailable');
    expect(missing.sockets).toHaveLength(0);
    expect(missing.getTicket).toHaveBeenCalledTimes(1);

    const forbidden = setup();
    forbidden.client.start();
    await tick();
    forbidden.sockets[0].drop(CLOSE.forbidden);
    await tick(60_000);
    expect(forbidden.client.currentStatus).toBe('unavailable');
    expect(forbidden.sockets).toHaveLength(1);
  });

  it('ошибка сети при билете — повтор с паузой; stop — без переподключений', async () => {
    const getTicket = vi.fn(async () => {
      if (getTicket.mock.calls.length === 1) throw new ApiError(0, 'NETWORK', 'нет сети');
      return 'ticket';
    });
    const { client, sockets } = setup(getTicket);
    client.start();
    await tick();
    expect(client.currentStatus).toBe('reconnecting');
    await tick(1000);
    expect(sockets).toHaveLength(1);
    client.stop();
    expect(sockets[0].closed?.code).toBe(CLOSE.normal);
    expect(client.currentStatus).toBe('closed');
    await tick(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('сеть вернулась — переподключаемся, не дожидаясь паузы', async () => {
    const { client, sockets } = setup();
    client.start();
    await tick();
    sockets[0].drop();
    await tick(100);
    client.reconnectNow();
    await tick();
    expect(sockets).toHaveLength(2);
  });
});
