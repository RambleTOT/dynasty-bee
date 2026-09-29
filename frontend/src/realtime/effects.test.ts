import { describe, expect, it } from 'vitest';
import { effectsFor, RESYNC_KEYS } from './effects';
import type { RealtimeEvent } from './protocol';

const ev = (kind: string, patch: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  seq: 1,
  id: null,
  kind,
  at: null,
  regionId: 'east',
  date: '2026-09-29',
  actor: null,
  data: {},
  ...patch,
});

describe('события живых обновлений → запросы и тосты', () => {
  it('оператор отменил в начатом дне — диспетчеру тост «ждёт решения» с переходом к предложению', () => {
    const { invalidate, notice } = effectsFor(
      ev('plan.proposed', {
        actor: { role: 'operator', name: 'Оператор' },
        data: {
          plan_id: 'P9',
          event_type: 'order_cancelled',
          source: 'operator',
          order_id: '10211',
        },
      }),
      'dispatcher',
    );
    expect(notice).toEqual({
      text: 'Оператор отменил №10211 — ждёт решения',
      kind: 'info',
      description: 'Восток · 29.09',
      link: '/dispatcher/day/2026-09-29?region=east&proposal=P9',
      persistent: true,
    });
    expect(invalidate).toEqual([
      ['days', '2026-09-29'],
      ['calendar'],
      ['plan'],
      ['booking', 'search'],
      ['booking', 'slots'],
    ]);
  });

  it('тексты предложений: «Прервать» инженера, авария, недоступность, неизвестный тип', () => {
    const text = (data: Record<string, unknown>, role = 'engineer') =>
      effectsFor(ev('plan.proposed', { actor: { role, name: null }, data }), 'dispatcher').notice
        ?.text;
    expect(
      text({
        event_type: 'order_cancelled',
        source: 'engineer',
        engineer_name: 'Бригада 3',
        order_id: '7',
      }),
    ).toBe('Бригада 3: «Прервать» №7 — ждёт решения');
    expect(text({ event_type: 'urgent_order_added', order_id: 'BK-1' }, 'operator')).toBe(
      'Авария №BK-1 — ждёт решения',
    );
    expect(text({ event_type: 'engineer_unavailable', engineer_name: 'Бригада 5' })).toBe(
      'Бригада 5 не может работать — ждёт решения',
    );
    expect(text({ event_type: 'что-то новое' }, 'system')).toBe('Новое предложение — ждёт решения');
  });

  it('своё предложение диспетчер тостом не получает; инженер и оператор — тоже нет', () => {
    const own = ev('plan.proposed', {
      actor: { role: 'dispatcher', name: 'Диспетчер' },
      data: { plan_id: 'P1' },
    });
    expect(effectsFor(own, 'dispatcher').notice).toBeNull();
    const foreign = ev('plan.proposed', {
      actor: { role: 'operator', name: null },
      data: { plan_id: 'P1' },
    });
    expect(effectsFor(foreign, 'engineer').notice).toBeNull();
    expect(effectsFor(foreign, 'operator').notice).toBeNull();
  });

  it('решение диспетчера — тост оператору', () => {
    const decision = (data: Record<string, unknown>) =>
      effectsFor(ev('booking.decision', { regionId: 'south_center', data }), 'operator').notice;
    expect(decision({ request_id: 'BK-0001', action: 'cancel', decision: 'accepted' })).toEqual({
      text: 'Диспетчер подтвердил отмену №BK-0001',
      kind: 'success',
      description: 'Югоцентр · 29.09',
    });
    expect(decision({ request_id: 'BK-0001', action: 'cancel', decision: 'rejected' })?.text).toBe(
      'Диспетчер не принял отмену №BK-0001 — заявка остаётся в плане',
    );
    expect(
      decision({
        request_id: 'BK-7',
        action: 'emergency',
        decision: 'accepted',
        engineer_name: 'Бригада 2',
      })?.text,
    ).toBe('Авария №BK-7 → Бригада 2');
    expect(decision({ request_id: 'BK-7', action: 'что-то', decision: 'accepted' })).toBeNull();
    expect(decision({ action: 'cancel', decision: 'accepted' })).toBeNull();
  });

  it('действие инженера и часы — день, план и экран инженера; незнакомое событие — только день', () => {
    expect(effectsFor(ev('engineer.action'), 'dispatcher')).toEqual({
      invalidate: [
        ['days', '2026-09-29'],
        ['calendar'],
        ['plan'],
        ['engineerDay'],
        ['engineerRoute'],
      ],
      notice: null,
    });
    expect(effectsFor(ev('что-то.новое'), 'dispatcher').invalidate).toEqual([
      ['days', '2026-09-29'],
      ['calendar'],
    ]);
    expect(
      effectsFor(ev('что-то.новое', { regionId: null, date: null }), 'dispatcher').invalidate,
    ).toEqual([]);
    expect(effectsFor(ev('day.cleared', { date: null }), 'dispatcher').invalidate[0]).toEqual([
      'days',
    ]);
  });

  it('resync обновляет всё, что приходит с сервера', () => {
    expect(RESYNC_KEYS).toContainEqual(['days']);
    expect(RESYNC_KEYS).toContainEqual(['engineerDay']);
    expect(RESYNC_KEYS).toContainEqual(['booking']);
  });
});
