import { describe, expect, it } from 'vitest';
import {
  overlayBaseline,
  overlayCompare,
  overlayModel,
  overlayPlan,
} from './__fixtures__/dayOverlays';
import { buildCompare } from './compare';
import { buildDaySummary } from './summary';

const model = overlayModel();
const compare = buildCompare({
  model,
  plan: overlayPlan,
  compare: overlayCompare,
  baseline: overlayBaseline,
});

describe('итоги дня DS-10', () => {
  it('карточки по статусам заявок; подписи — только где есть данные', () => {
    const { cards } = buildDaySummary(model, compare);
    expect(cards).toEqual([
      { key: 'done', label: 'Выполнено', value: 1, note: 'из 4 назначенных' },
      { key: 'cancelled', label: 'Отменено', value: 1, note: 'клиент отказался' },
      { key: 'rescheduled', label: 'Перенесено', value: 1, note: 'на 01.10' },
      { key: 'unassigned', label: 'Неназначенные', value: 1, note: 'перейдут на 30.09' },
    ]);
  });

  it('без причины отмены и даты переноса (⏳ бэк §6) — подписи нет', () => {
    const bare = {
      ...model,
      requests: model.requests.map((r) => ({
        ...r,
        raw: { ...r.raw, cancel_reason: undefined, rescheduled_to: undefined },
      })),
    };
    const { cards } = buildDaySummary(bare, compare);
    expect(cards.find((c) => c.key === 'cancelled')?.note).toBeNull();
    expect(cards.find((c) => c.key === 'rescheduled')?.note).toBeNull();
  });

  it('перенос на несколько дат — самая ранняя; причина — самая частая по-русски', () => {
    const base = model.requests.find((r) => r.id === '305800006')!;
    const copy = (id: string, status: string, raw: Record<string, unknown>) => ({
      ...base,
      id,
      status,
      raw: { ...base.raw, ...raw },
    });
    const many = {
      ...model,
      requests: [
        ...model.requests,
        copy('x1', 'rescheduled', { rescheduled_to: '2026-09-30' }),
        copy('x2', 'rescheduled', { rescheduled_to: '2026-10-03' }),
        copy('x3', 'cancelled', { cancel_reason: 'other' }),
        copy('x4', 'cancelled', { cancel_reason: 'other' }),
      ],
    };
    const { cards } = buildDaySummary(many, compare);
    expect(cards.find((c) => c.key === 'rescheduled')).toMatchObject({
      value: 3,
      note: 'на 30.09',
    });
    expect(cards.find((c) => c.key === 'cancelled')).toMatchObject({ value: 3, note: 'другое' });
  });

  it('крупные показатели: значение и Δ к FIFO из «Сравнения»', () => {
    const { metrics } = buildDaySummary(model, compare);
    expect(metrics).toEqual([
      {
        key: 'inWindow',
        label: 'Начато в окне',
        value: '3 из 4',
        delta: '+1 к FIFO',
        highlight: false,
      },
      {
        key: 'km',
        label: 'Пробег суммарно, км',
        value: '18,6',
        delta: '−6,4 км (−26%) к FIFO',
        highlight: true,
      },
      {
        key: 'engineers',
        label: 'Задействовано инженеров',
        value: '2',
        delta: '−1 инженер к FIFO',
        highlight: false,
      },
    ]);
  });

  it('без сравнения — значения по плану, Δ нет', () => {
    const { metrics } = buildDaySummary(model, null);
    expect(metrics.map((m) => [m.value, m.delta])).toEqual([
      ['3 из 4', null],
      ['18,6', null],
      ['2', null],
    ]);
  });

  it('таблица по бригадам: задействованные, факт важнее плана', () => {
    const { rows } = buildDaySummary(model, compare);
    expect(
      rows.map(
        ({ engineerId, tasks, done, inWindow, km, travelMinutes, workMinutes, waitMinutes }) => ({
          engineerId,
          tasks,
          done,
          inWindow,
          km,
          travelMinutes,
          workMinutes,
          waitMinutes,
        }),
      ),
    ).toEqual([
      // работа …0001 — по факту 10:10–11:00 (50 мин), …0002 — по плану 12:30–13:40 (70 мин)
      {
        engineerId: 'e1',
        tasks: 2,
        done: 1,
        inWindow: 2,
        km: 8.4,
        travelMinutes: 35,
        workMinutes: 120,
        waitMinutes: 10,
      },
      {
        engineerId: 'e2',
        tasks: 2,
        done: 0,
        inWindow: 1,
        km: 10.2,
        travelMinutes: 35,
        workMinutes: 60,
        waitMinutes: 0,
      },
    ]);
    expect(rows[0]).toMatchObject({ label: 'Бригада Соколов', short: 'Соколов' });
  });
});
