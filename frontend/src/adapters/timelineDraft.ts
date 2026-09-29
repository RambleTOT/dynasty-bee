/**
 * Черновик плана на таймлайне (§8.2 пп. 22–23): предложение, сравнение версий и ручное
 * переназначение показываем теми же строками бригад, что и день. Изменённые бригады — ярко,
 * остальные приглушены, прежнее место визита — пунктиром.
 */
import type { PlanResponse } from '@/api/types';
import { fromMin, toMin } from '@/lib/time';
import type { DayModel, DayRequest } from './dayModel';

export interface GhostVisit {
  requestId: string;
  label: string;
  start: string;
  end: string;
}

export interface TimelineOverlay {
  /** Бригады, у которых меняется маршрут: их строки яркие, остальные приглушены. */
  changed: ReadonlySet<string>;
  /** Прежнее место визитов изменённых бригад, по бригаде. */
  ghost: ReadonlyMap<string, GhostVisit[]>;
  /** Визиты на новом месте: другая бригада или другое время. */
  moved: ReadonlySet<string>;
}

interface Slot {
  engineerId: string;
  start: string;
  end: string;
}

function slotsOf(plan: Pick<PlanResponse, 'routes'> | null): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const route of plan?.routes ?? []) {
    for (const point of route.route ?? []) {
      slots.set(point.request_id, {
        engineerId: route.engineer_id,
        start: point.start,
        end: point.end,
      });
    }
  }
  return slots;
}

const sameSlot = (a: Slot | undefined, b: Slot | undefined) =>
  Boolean(a && b && a.engineerId === b.engineerId && a.start === b.start && a.end === b.end);

function overlayOf(
  before: Map<string, Slot>,
  after: Map<string, Slot>,
  labelOf: (requestId: string) => string,
): TimelineOverlay {
  const changed = new Set<string>();
  const moved = new Set<string>();
  const ghost = new Map<string, GhostVisit[]>();
  for (const [id, slot] of after) {
    const old = before.get(id);
    if (sameSlot(old, slot)) continue;
    moved.add(id);
    changed.add(slot.engineerId);
  }
  for (const [id, old] of before) {
    if (sameSlot(old, after.get(id))) continue;
    changed.add(old.engineerId);
    const list = ghost.get(old.engineerId) ?? [];
    list.push({ requestId: id, label: labelOf(id), start: old.start, end: old.end });
    ghost.set(old.engineerId, list);
  }
  return { changed, ghost, moved };
}

/** Новая версия (предложение) против прежней: что сдвинулось и откуда. */
export function planOverlay(
  next: Pick<PlanResponse, 'routes'> | null,
  base: Pick<PlanResponse, 'routes'> | null,
  labelOf: (requestId: string) => string,
): TimelineOverlay {
  return overlayOf(slotsOf(base), slotsOf(next), labelOf);
}

export interface ReassignDraftInput {
  requestId: string;
  toEngineerId: string;
  /** Начало визита у новой бригады по проверке (`new_start`). */
  newStart: string;
  /** Сдвиг визитов новой бригады по проверке (`shifted_visits`). */
  shifted: readonly { orderId: string; deltaMin: number }[];
}

const shift = (time: string, delta: number) => fromMin(toMin(time) + delta);

/**
 * Черновик ручного переназначения по ответу проверки: заявка — у новой бригады с `new_start`,
 * визиты новой бригады сдвинуты на `delta_min`. Версию бэк ещё не создал — модель дня копируем.
 */
export function reassignDraft(
  model: DayModel,
  input: ReassignDraftInput,
): { model: DayModel; overlay: TimelineOverlay } | null {
  const moving = model.requestById.get(input.requestId);
  if (!moving || !Number.isFinite(toMin(input.newStart))) return null;
  const deltas = new Map(input.shifted.map((s) => [s.orderId, s.deltaMin]));

  const before = new Map<string, Slot>();
  const after = new Map<string, Slot>();
  const requests: DayRequest[] = model.requests.map((request) => {
    const visit = request.visit;
    if (visit && request.engineerId) {
      before.set(request.id, { engineerId: request.engineerId, start: visit.start, end: visit.end });
    }
    if (request.id === input.requestId) {
      const start = input.newStart;
      const end = fromMin(toMin(start) + request.durationMinutes);
      after.set(request.id, { engineerId: input.toEngineerId, start, end });
      return {
        ...request,
        engineerId: input.toEngineerId,
        status: request.status === 'unassigned' ? 'planned' : request.status,
        visit: {
          requestId: request.id,
          engineerId: input.toEngineerId,
          sequence: visit?.sequence ?? 0,
          arrival: start,
          start,
          end,
          travelMinutes: 0,
          legKm: 0,
          waitingMinutes: 0,
          slackMinutes: null,
          frozen: false,
          status: 'planned',
          flags: [],
          actualStart: null,
          actualEnd: null,
          point: visit?.point ?? request.point,
        },
      };
    }
    const delta = deltas.get(request.id);
    if (visit && request.engineerId && delta) {
      const moved = {
        ...visit,
        arrival: shift(visit.arrival, delta),
        start: shift(visit.start, delta),
        end: shift(visit.end, delta),
      };
      after.set(request.id, { engineerId: request.engineerId, start: moved.start, end: moved.end });
      return { ...request, visit: moved };
    }
    if (visit && request.engineerId) {
      after.set(request.id, { engineerId: request.engineerId, start: visit.start, end: visit.end });
    }
    return request;
  });

  const draft: DayModel = {
    ...model,
    requests,
    requestById: new Map(requests.map((r) => [r.id, r])),
    unassigned: model.unassigned.filter((u) => u.requestId !== input.requestId),
  };
  const labelOf = (id: string) => model.requestById.get(id)?.shortId ?? id;
  return { model: draft, overlay: overlayOf(before, after, labelOf) };
}
