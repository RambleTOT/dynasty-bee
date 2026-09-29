/**
 * Цепочка версий дня. На бэке 28.09 версии после события живут в производных сценариях: `/days`
 * отдаёт первую применённую версию и не видит предложений к следующим (docs/API_NOTES.md).
 * Поэтому голову цепочки находим сами: от `active_plan_id` дня идём по событиям
 * (`plan_id` → `result_plan_id`) к применённым версиям. Бэк с правкой BACKEND_REQUESTS п. 3 отдаёт
 * голову сам — тогда прежние версии дня находим назад по тем же событиям.
 *
 * «Править вручную» из предложения: переназначение считается от предложения и сразу применяется —
 * предложение входит в эту версию (`consumed`), отдельной версией его не считаем.
 * Предложение к прежней версии принять нельзя (`409 STALE_PROPOSAL`) — оно «устарело»
 * (`staleProposals`), его можно пересчитать на действующей (BACKEND_REQUESTS п. 48).
 */
import type { DayRegion, EventItem, PendingProposal, PlanListItem } from '@/api/types';

// версии дня: действующая и прежние (`superseded` — была действующей до следующего «Принять»)
const LIVE_STATUSES = new Set(['applied', 'completed', 'superseded']);
const MAX_DEPTH = 100;

export interface DayVersion {
  planId: string;
  /** Номер по порядку: первая применённая версия дня — 1. */
  version: number;
  createdAt: string | null;
  status: string;
  engineersUsed: number | null;
  plannedCount: number | null;
  distanceKm: number | null;
  /** Событие, которое породило версию; у первой — нет. */
  event: EventItem | null;
  /** Версия — ручная правка предложения: событие этого предложения. */
  via: EventItem | null;
}

/** Предложение к прежней версии дня: ждёт пересчёта на действующей. */
export interface StaleProposal {
  planId: string;
  /** Событие, из которого посчитано предложение. */
  event: EventItem;
  /** Номер версии, от которой считалось. */
  baseVersion: number | null;
}

export interface DayChain {
  /** Действующая версия (или черновик дня из записей оператора). */
  headPlanId: string | null;
  /** Номер действующей версии; 0 — плана нет или он не опубликован. */
  version: number;
  /** Применённые версии, новые сверху. */
  versions: DayVersion[];
  /** Предложения к действующей версии, ждущие решения. */
  pendingProposals: PendingProposal[];
  /** Предложения к прежним версиям, которые ещё не пересчитали, новые сверху. */
  staleProposals: StaleProposal[];
  /** Предложения, вошедшие в версию через «Править вручную»: id предложения → id версии. */
  consumed: ReadonlyMap<string, string>;
  /**
   * Заявки, отменённые принятыми событиями дня. Бэк оставляет их в сценарии со статусом
   * «не назначена», и следующее событие возвращает их в неназначенные (BACKEND_REQUESTS п. 49).
   */
  cancelledIds: ReadonlySet<string>;
  /** События дня — по всем версиям цепочки, новые сверху. */
  events: EventItem[];
  /** Статусы известных планов: ленте нужно знать, ждёт ли предложение решения. */
  planStatus: ReadonlyMap<string, string>;
}

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

const newestFirst = (a: EventItem, b: EventItem) => time(b.created_at) - time(a.created_at);

function headlineOf(event: EventItem): string | null {
  const headline = event.payload?.headline;
  return typeof headline === 'string' && headline.trim() ? headline : null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * Кого касается событие: заявка или бригада. Пересчитали устаревшее предложение — на той же
 * заявке (бригаде) появилось событие того же типа позже; у событий без цели — `null`.
 */
export function eventTarget(event: Pick<EventItem, 'event_type' | 'payload'>): string | null {
  const p = event.payload ?? {};
  switch (event.event_type) {
    case 'urgent_order_added':
    case 'order_added':
    case 'order_cancelled':
      return text(p.request_id) ?? text(p.order_id);
    case 'manual_reassign':
      return text(p.order_id) ?? text(p.request_id);
    case 'engineer_unavailable':
    case 'engineer_available':
    case 'transport_changed':
      return text(p.engineer_id);
    default:
      return null;
  }
}

export function resolveDayChain(
  region: Pick<
    DayRegion,
    'scenario_id' | 'active_plan_id' | 'draft_plan_id' | 'plan_state' | 'version' | 'pending_proposals'
  >,
  events: readonly EventItem[],
  plans: readonly PlanListItem[],
): DayChain {
  const planStatus = new Map(plans.map((p) => [p.plan_id, p.status]));
  const planById = new Map(plans.map((p) => [p.plan_id, p]));
  const byBase = new Map<string, EventItem[]>();
  const byResult = new Map<string, EventItem[]>();
  for (const event of events) {
    if (!event.plan_id) continue;
    const list = byBase.get(event.plan_id) ?? [];
    list.push(event);
    byBase.set(event.plan_id, list);
    if (event.result_plan_id && event.result_plan_id !== event.plan_id) {
      const produced = byResult.get(event.result_plan_id) ?? [];
      produced.push(event);
      byResult.set(event.result_plan_id, produced);
    }
  }
  // из событий, которые дали версию, берём причину, а не `plan_applied`
  const causeFirst = (a: EventItem, b: EventItem) =>
    Number(a.event_type === 'plan_applied') - Number(b.event_type === 'plan_applied') || newestFirst(a, b);

  const root = region.active_plan_id ?? null;
  const draft = region.draft_plan_id ?? null;
  const chain: { planId: string; event: EventItem | null; via: EventItem | null }[] = [];
  const consumed = new Map<string, string>();
  const isProposed = (planId: string | null | undefined) => Boolean(planId) && planStatus.get(planId as string) === 'proposed';

  if (root) {
    chain.push({ planId: root, event: null, via: null });
    const visited = new Set([root]);
    // `plan_applied` первой версии ссылается сам на себя — петли и пройденные версии пропускаем
    const liveFrom = (base: string) =>
      (byBase.get(base) ?? [])
        .filter(
          (e) =>
            e.result_plan_id &&
            !visited.has(e.result_plan_id) &&
            LIVE_STATUSES.has(planStatus.get(e.result_plan_id) ?? ''),
        )
        .sort(causeFirst)[0];
    let head = root;
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      let next = liveFrom(head);
      let via: EventItem | null = null;
      if (!next) {
        // голова → предложение → его ручная правка (применена сразу)
        for (const proposal of [...(byBase.get(head) ?? [])].sort(newestFirst)) {
          if (!proposal.result_plan_id || visited.has(proposal.result_plan_id) || !isProposed(proposal.result_plan_id)) continue;
          const edit = liveFrom(proposal.result_plan_id);
          if (edit) {
            next = edit;
            via = proposal;
            break;
          }
        }
      }
      if (!next?.result_plan_id) break;
      if (via?.result_plan_id) {
        visited.add(via.result_plan_id);
        consumed.set(via.result_plan_id, next.result_plan_id);
      }
      head = next.result_plan_id;
      visited.add(head);
      chain.push({ planId: head, event: next, via });
    }
    // назад: какая версия была до `active_plan_id` дня (бэк с правкой п. 3 отдаёт уже голову)
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      const first = chain[0];
      const cause = [...(byResult.get(first.planId) ?? [])].sort(causeFirst)[0];
      if (!cause?.plan_id || visited.has(cause.plan_id)) break;
      visited.add(cause.plan_id);
      first.event = cause;
      let base = cause.plan_id;
      if (isProposed(base)) {
        // версия — ручная правка предложения: оно вошло в неё, версия до него — его основа
        consumed.set(base, first.planId);
        const inner = [...(byResult.get(base) ?? [])].sort(causeFirst)[0];
        first.via = inner ?? null;
        if (!inner?.plan_id || visited.has(inner.plan_id)) break;
        base = inner.plan_id;
        visited.add(base);
      }
      chain.unshift({ planId: base, event: null, via: null });
    }
  }

  const headPlanId = chain.at(-1)?.planId ?? draft;
  // Номера — по порядку в цепочке. Первая версия из сценария дня знает свой номер (1, после
  // повторного «Построить план» — 2); иначе считаем от номера `active_plan_id` из `/days`.
  const first = chain[0] ? planById.get(chain[0].planId) : undefined;
  const firstKnown =
    first && first.scenario_id === region.scenario_id && Number(first.version) > 0 ? Number(first.version) : null;
  const rootIndex = root ? chain.findIndex((c) => c.planId === root) : 0;
  const firstVersion = firstKnown ?? Math.max(1, (Number(region.version) || 1) - rootIndex);
  const version = root ? firstVersion + chain.length - 1 : 0;

  const versions: DayVersion[] = chain
    .map(({ planId, event, via }, index) => {
      const item = planById.get(planId);
      return {
        planId,
        version: firstVersion + index,
        createdAt: item?.created_at ?? event?.created_at ?? null,
        status: item?.status ?? (index === chain.length - 1 ? 'applied' : 'superseded'),
        engineersUsed: item?.engineers_used ?? null,
        plannedCount: item?.planned_count ?? null,
        distanceKm: item?.total_distance_km ?? null,
        event,
        via,
      };
    })
    .reverse();
  const versionOf = new Map(versions.map((v) => [v.planId, v.version]));

  // предложения к голове: из событий (бэк их не видит) + то, что бэк отдал сам
  const pendingProposals: PendingProposal[] = [];
  const seen = new Set<string>();
  const versionIds = new Set(chain.map((c) => c.planId));
  if (root && headPlanId) {
    for (const event of [...(byBase.get(headPlanId) ?? [])].sort(newestFirst)) {
      const planId = event.result_plan_id;
      if (!planId || seen.has(planId) || consumed.has(planId) || versionIds.has(planId)) continue;
      if (planStatus.get(planId) !== 'proposed') continue;
      seen.add(planId);
      pendingProposals.push({
        plan_id: planId,
        event_id: event.event_id,
        event_type: event.event_type,
        headline: headlineOf(event),
        created_at: event.created_at,
      });
    }
  }
  for (const proposal of region.pending_proposals ?? []) {
    if (seen.has(proposal.plan_id) || consumed.has(proposal.plan_id)) continue;
    if (planStatus.has(proposal.plan_id) && planStatus.get(proposal.plan_id) !== 'proposed') continue;
    seen.add(proposal.plan_id);
    pendingProposals.push(proposal);
  }

  const chainIds = new Set(chain.map((c) => c.planId));
  // устаревшие: к прежней версии дня, ещё не пересчитаны (позже нет события на ту же цель)
  const staleProposals: StaleProposal[] = [];
  const sorted = [...events].sort(newestFirst);
  for (const event of sorted) {
    const planId = event.result_plan_id;
    const base = event.plan_id;
    if (!planId || !base || seen.has(planId) || consumed.has(planId) || !isProposed(planId)) continue;
    // уже версия дня (список планов ещё не обновился после «Принять») — не устаревшее
    if (chainIds.has(planId) || base === headPlanId || !chainIds.has(base)) continue;
    const target = eventTarget(event);
    const redone =
      target !== null &&
      sorted.some(
        (later) =>
          later !== event &&
          later.event_type === event.event_type &&
          time(later.created_at) > time(event.created_at) &&
          eventTarget(later) === target,
      );
    if (redone) continue;
    seen.add(planId);
    staleProposals.push({ planId, event, baseVersion: versionOf.get(base) ?? null });
  }

  // правка предложения и её «Принять» записаны на предложение — они тоже события дня
  for (const planId of consumed.keys()) chainIds.add(planId);
  if (draft) chainIds.add(draft);
  const dayEvents = events
    .filter(
      (e) =>
        (e.plan_id && chainIds.has(e.plan_id)) ||
        (region.scenario_id && e.scenario_id === region.scenario_id),
    )
    .filter((e, i, list) => list.findIndex((x) => x.event_id === e.event_id) === i)
    .sort(newestFirst);

  const accepted = new Set([...versionIds, ...consumed.keys()]);
  const cancelledIds = new Set<string>();
  for (const event of dayEvents) {
    if (event.event_type !== 'order_cancelled' || !event.result_plan_id || !accepted.has(event.result_plan_id)) continue;
    const id = eventTarget(event);
    if (id) cancelledIds.add(id);
  }

  return {
    headPlanId,
    version,
    versions,
    pendingProposals,
    staleProposals,
    consumed,
    cancelledIds,
    events: dayEvents,
    planStatus,
  };
}
