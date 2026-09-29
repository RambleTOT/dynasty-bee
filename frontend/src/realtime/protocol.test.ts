import { describe, expect, it } from 'vitest';
import { parseServerMessage } from './protocol';

describe('протокол живых обновлений', () => {
  it('hello, ping, resync, error', () => {
    expect(parseServerMessage('{"type":"hello","protocol":1,"seq":42,"resumed":true}')).toEqual({
      type: 'hello',
      protocol: 1,
      seq: 42,
      resumed: true,
    });
    expect(parseServerMessage('{"type":"ping","t":"2026-09-29T12:00:00+03:00"}')).toEqual({
      type: 'ping',
    });
    expect(parseServerMessage({ type: 'resync' })).toEqual({ type: 'resync' });
    expect(parseServerMessage('{"type":"error","code":"RATE_LIMIT"}')).toEqual({
      type: 'error',
      code: 'RATE_LIMIT',
      message: '',
    });
  });

  it('событие: поля в camelCase, data — объект, пустое — null', () => {
    const message = parseServerMessage(
      JSON.stringify({
        type: 'event',
        seq: 43,
        id: 'ev-1',
        kind: 'plan.proposed',
        at: '2026-09-29T12:35:10+03:00',
        region_id: 'east',
        date: '2026-09-29',
        actor: { role: 'operator', name: 'Оператор' },
        data: { plan_id: 'P2', event_type: 'order_cancelled', order_id: '10211' },
      }),
    );
    expect(message).toEqual({
      type: 'event',
      event: {
        seq: 43,
        id: 'ev-1',
        kind: 'plan.proposed',
        at: '2026-09-29T12:35:10+03:00',
        regionId: 'east',
        date: '2026-09-29',
        actor: { role: 'operator', name: 'Оператор' },
        data: { plan_id: 'P2', event_type: 'order_cancelled', order_id: '10211' },
      },
    });
    const bare = parseServerMessage('{"type":"event","seq":44,"kind":"clock.changed","data":[]}');
    expect(bare).toMatchObject({
      event: { regionId: null, date: null, actor: null, data: {} },
    });
  });

  it('мусор и незнакомое — null', () => {
    expect(parseServerMessage('не json')).toBeNull();
    expect(parseServerMessage('[1,2]')).toBeNull();
    expect(parseServerMessage('{"type":"subscribe"}')).toBeNull();
    expect(parseServerMessage('{"type":"hello"}')).toBeNull();
    expect(parseServerMessage('{"type":"event","kind":"plan.applied"}')).toBeNull();
    expect(parseServerMessage('{"type":"event","seq":-1,"kind":"plan.applied"}')).toBeNull();
  });
});
