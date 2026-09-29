import { describe, expect, it } from 'vitest';
import {
  makeEngineer,
  makePlan,
  makePoint,
  makeRegion,
  makeRequest,
  makeRoute,
  makeScenario,
} from './__fixtures__/day';
import { buildDayModel } from './dayModel';
import { planOverlay, reassignDraft } from './timelineDraft';

const label = (id: string) => `№${id}`;

describe('planOverlay — черновик предложения на таймлайне', () => {
  it('изменённые бригады, новое место визита и прежнее — пунктиром', () => {
    const base = makePlan({
      plan_id: 'P1',
      routes: [
        makeRoute('E1', [
          makePoint({ request_id: 'A', sequence: 1, start: '10:05', end: '11:15' }),
          makePoint({ request_id: 'B', sequence: 2, start: '12:00', end: '13:10' }),
        ]),
        makeRoute('E2', [makePoint({ request_id: 'C', sequence: 1, start: '10:10', end: '11:20' })]),
        makeRoute('E3', [makePoint({ request_id: 'D', sequence: 1, start: '10:10', end: '11:20' })]),
      ],
    });
    const next = makePlan({
      plan_id: 'P2',
      routes: [
        makeRoute('E1', [makePoint({ request_id: 'A', sequence: 1, start: '10:05', end: '11:15' })]),
        makeRoute('E2', [
          makePoint({ request_id: 'C', sequence: 1, start: '10:10', end: '11:20' }),
          makePoint({ request_id: 'B', sequence: 2, start: '12:20', end: '13:30' }),
          makePoint({ request_id: 'U', sequence: 3, start: '14:00', end: '15:00' }),
        ]),
        makeRoute('E3', [makePoint({ request_id: 'D', sequence: 1, start: '10:10', end: '11:20' })]),
      ],
    });
    const overlay = planOverlay(next, base, label);
    expect([...overlay.changed].sort()).toEqual(['E1', 'E2']);
    expect([...overlay.moved].sort()).toEqual(['B', 'U']);
    expect(overlay.ghost.get('E1')).toEqual([{ requestId: 'B', label: '№B', start: '12:00', end: '13:10' }]);
    expect(overlay.ghost.has('E2')).toBe(false);
    expect(overlay.ghost.has('E3')).toBe(false);
  });
});

describe('reassignDraft — черновик ручного переназначения', () => {
  const scenario = makeScenario({
    engineers: [makeEngineer({ id: 'E1' }), makeEngineer({ id: 'E2' })],
    requests: [
      makeRequest({ id: 'R1', duration_minutes: 60 }),
      makeRequest({ id: 'R2', duration_minutes: 60 }),
      makeRequest({ id: 'R3', duration_minutes: 30, status: 'unassigned' }),
    ],
  });
  const plan = makePlan({
    plan_id: 'P1',
    routes: [
      makeRoute('E1', [makePoint({ request_id: 'R1', sequence: 1, start: '10:05', end: '11:05' })]),
      makeRoute('E2', [makePoint({ request_id: 'R2', sequence: 1, start: '12:00', end: '13:00' })]),
    ],
    unassigned: [{ request_id: 'R3', reason_code: 'NO_CAPACITY', reason: 'Нет бригады', proven_static: false }],
  });
  const model = buildDayModel({
    date: '2026-09-29',
    region: makeRegion({ active_plan_id: 'P1', plan_state: 'applied', version: 1 }),
    scenario,
    plan,
  });

  it('заявка у новой бригады с началом по проверке, сдвинутые визиты', () => {
    const draft = reassignDraft(model, {
      requestId: 'R1',
      toEngineerId: 'E2',
      newStart: '11:00',
      shifted: [{ orderId: 'R2', deltaMin: 15 }],
    });
    expect(draft).not.toBeNull();
    const moved = draft!.model.requestById.get('R1')!;
    expect(moved.engineerId).toBe('E2');
    expect([moved.visit?.start, moved.visit?.end]).toEqual(['11:00', '12:00']);
    expect(draft!.model.requestById.get('R2')!.visit?.start).toBe('12:15');
    expect([...draft!.overlay.changed].sort()).toEqual(['E1', 'E2']);
    expect([...draft!.overlay.moved].sort()).toEqual(['R1', 'R2']);
    expect(draft!.overlay.ghost.get('E1')?.map((g) => g.requestId)).toEqual(['R1']);
    // модель дня не меняется
    expect(model.requestById.get('R1')!.engineerId).toBe('E1');
  });

  it('неназначенная заявка уходит из списка неназначенных черновика', () => {
    const draft = reassignDraft(model, { requestId: 'R3', toEngineerId: 'E1', newStart: '12:00', shifted: [] });
    expect(draft!.model.unassigned.map((u) => u.requestId)).toEqual([]);
    expect(draft!.model.requestById.get('R3')!.visit?.end).toBe('12:30');
    expect(model.unassigned.map((u) => u.requestId)).toEqual(['R3']);
  });
});
