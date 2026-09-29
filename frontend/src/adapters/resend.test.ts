import { describe, expect, it } from 'vitest';
import { makeEvent, makeRequest } from './__fixtures__/day';
import { canRebuild, rebuildEvent, requestIdOf } from './resend';

describe('rebuildEvent — «Пересчитать» устаревшее предложение', () => {
  it('срочная: заявка из сценария предложения, прежнее время, новая версия', () => {
    const event = makeEvent({
      event_id: 'E1',
      event_type: 'urgent_order_added',
      payload: { time: '12:41', request_id: 'U-0427', priority: 'urgent' },
    });
    const request = makeRequest({
      id: 'U-0427',
      latitude: 55.7,
      longitude: 37.7,
      address: 'Москва, Тверская улица, 7',
      duration_minutes: 60,
      window_start: '12:41',
      window_end: '22:00',
      priority: 'urgent',
      required_skill: 'emergency',
      required_transport: 'car',
      type_bk: 'Авария',
      type_hd: 'Нет сигнала',
      district: null,
    });
    expect(requestIdOf(event)).toBe('U-0427');
    expect(rebuildEvent(event, 'HEAD', request)).toEqual({
      type: 'urgent_order_added',
      plan_id: 'HEAD',
      event_time: '12:41',
      request: {
        id: 'U-0427',
        duration_minutes: 60,
        window_start: '12:41',
        window_end: '22:00',
        priority: 'urgent',
        required_skill: 'emergency',
        latitude: 55.7,
        longitude: 37.7,
        address: 'Москва, Тверская улица, 7',
        required_transport: 'car',
        type_bk: 'Авария',
        type_hd: 'Нет сигнала',
        source: 'dispatcher',
      },
    });
    // без заявки из сценария срочную не собрать
    expect(rebuildEvent(event, 'HEAD', null)).toBeNull();
  });

  it('отмена «Прервать» инженера: причина, этап и прежний статус — как в журнале', () => {
    const event = makeEvent({
      event_id: 'E2',
      event_type: 'order_cancelled',
      payload: {
        time: '12:30',
        request_id: '10197',
        reason: 'no_access',
        stage: 'on_site',
        previous_status: 'in_progress',
        source: 'engineer',
      },
    });
    expect(rebuildEvent(event, 'HEAD')).toEqual({
      type: 'order_cancelled',
      plan_id: 'HEAD',
      event_time: '12:30',
      order_id: '10197',
      params: { reason: 'no_access', stage: 'on_site', previous_status: 'in_progress' },
    });
  });

  it('бригада недоступна, снова доступна, сменила транспорт', () => {
    const off = makeEvent({
      event_id: 'E3',
      event_type: 'engineer_unavailable',
      payload: { time: '13:00', engineer_id: 'E05', reason: 'Заболел' },
    });
    expect(rebuildEvent(off, 'HEAD')).toEqual({
      type: 'engineer_unavailable',
      plan_id: 'HEAD',
      event_time: '13:00',
      engineer_id: 'E05',
      params: { reason: 'Заболел' },
    });
    const on = makeEvent({ event_id: 'E4', event_type: 'engineer_available', payload: { engineer_id: 'E05' } });
    expect(rebuildEvent(on, 'HEAD')).toEqual({ type: 'engineer_available', plan_id: 'HEAD', engineer_id: 'E05' });
    const car = makeEvent({
      event_id: 'E5',
      event_type: 'transport_changed',
      payload: { engineer_id: 'E02', transport: 'car' },
    });
    expect(rebuildEvent(car, 'HEAD')).toEqual({
      type: 'transport_changed',
      plan_id: 'HEAD',
      engineer_id: 'E02',
      params: { transport: 'car' },
    });
  });

  it('незнакомый тип и неполный журнал — не собираем', () => {
    const added = makeEvent({ event_id: 'E6', event_type: 'engineer_added', payload: { engineer_id: 'E13' } });
    expect(canRebuild(added)).toBe(false);
    expect(rebuildEvent(added, 'HEAD')).toBeNull();
    const noOrder = makeEvent({ event_id: 'E7', event_type: 'order_cancelled', payload: { reason: 'other' } });
    expect(canRebuild(noOrder)).toBe(true);
    expect(rebuildEvent(noOrder, 'HEAD')).toBeNull();
  });
});
