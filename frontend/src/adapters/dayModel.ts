/**
 * Модель дня диспетчера (FRONTEND_SPEC §6.1): сценарий + план + состояние дня → всё, что нужно карте,
 * таймлайну, панели и карточкам. В точке маршрута нет полей заявки, поэтому склеиваем со ScenarioOut.
 */
import type {
  DayRegion,
  EngineerOut,
  ExplanationOut,
  PendingProposal,
  PlanResponse,
  PlanState,
  RequestOut,
  RoutePoint,
  ScenarioOut,
} from '@/api/types';
import { engineerColors, type EngineerColor } from '@/lib/colors';
import { BK, isEmergency, skillLabel, transportLabel } from '@/lib/dictionaries';
import { isValidLatLng, type LatLng } from '@/lib/map';
import {
  isRequestStatus,
  knownFlags,
  type Flag,
  type RequestStatus,
} from '@/lib/statuses';
import { nowFor, timelineAxis, windowFull, windowShort, type TimeAxis } from '@/lib/time';
import type { DayChain } from './dayChain';
import {
  coordinatesFor,
  engineerLabels,
  isSynthetic,
  mapPoint,
  requestLabels,
  type CoordTransform,
  type Coordinates,
} from './normalize';

export interface DayEngineer {
  id: string;
  label: string;
  short: string;
  color: EngineerColor;
  /** Фактический транспорт, если инженер сменил его в начале смены, иначе по справочнику. */
  transport: string;
  transportLabel: string;
  skills: string[];
  skillLabels: string[];
  shiftStart: string;
  shiftEnd: string;
  available: boolean;
  shiftStatus: string;
  availableUntil: string | null;
  start: LatLng | null;
  startKind: string;
  taskCount: number;
  distanceKm: number;
  /** В плане есть заявки этой бригады. */
  used: boolean;
  raw: EngineerOut;
}

export interface DayVisit {
  requestId: string;
  engineerId: string;
  sequence: number;
  arrival: string;
  start: string;
  end: string;
  travelMinutes: number;
  legKm: number;
  waitingMinutes: number;
  slackMinutes: number | null;
  frozen: boolean;
  status: RequestStatus | string;
  flags: Flag[];
  actualStart: string | null;
  actualEnd: string | null;
  point: LatLng | null;
}

export interface DayRequest {
  id: string;
  shortId: string;
  number: string;
  typeShort: string;
  typeFull: string;
  typeBk: string;
  hasAddress: boolean;
  addressText: string;
  district: string | null;
  windowStart: string;
  windowEnd: string;
  windowShort: string;
  windowFull: string;
  durationMinutes: number;
  skill: string;
  skillLabel: string;
  requiredTransport: string | null;
  requiredTransportLabel: string;
  gigabit: boolean;
  technology: string | null;
  status: RequestStatus | string;
  flags: Flag[];
  urgent: boolean;
  /** Авария: красный маркер с молнией и красный блок — по HD «Авария» (D-37, `isEmergency`). */
  emergency: boolean;
  point: LatLng | null;
  engineerId: string | null;
  visit: DayVisit | null;
  dispatcherEngineerId: string | null;
  raw: RequestOut;
}

export interface DayRoute {
  engineerId: string;
  visits: DayVisit[];
  distanceKm: number;
  taskCount: number;
  start: LatLng | null;
  geometrySource: string | null;
}

export interface DayUnassigned {
  requestId: string;
  reasonCode: string;
  reason: string;
}

export interface TypeOption {
  value: string;
  label: string;
}

export interface DayModel {
  date: string;
  regionId: string;
  scenarioId: string;
  planState: PlanState;
  version: number;
  /** Источник дня: `csv`, `booking` (записи оператора), `demo`… */
  source: string;
  /** День из CSV (есть «реальный диспетчер» и кнопка «Построить план»). */
  fromCsv: boolean;
  synthetic: boolean;
  coordsApprox: boolean;
  transform: CoordTransform;
  office: { point: LatLng; address: string | null } | null;
  /** Часы дня (D-24) — `null`, если бэк их не задал. */
  clock: string | null;
  /** «Сейчас» дня: часы или реальное московское время. */
  now: string;
  planId: string | null;
  plan: PlanResponse | null;
  engineers: DayEngineer[];
  engineerById: Map<string, DayEngineer>;
  requests: DayRequest[];
  requestById: Map<string, DayRequest>;
  routes: DayRoute[];
  routeByEngineer: Map<string, DayRoute>;
  unassigned: DayUnassigned[];
  explanations: Map<string, ExplanationOut>;
  axis: TimeAxis | null;
  pendingProposals: PendingProposal[];
  typeOptions: TypeOption[];
  lastRecalc: { at: string; requestId: string | null } | null;
}

const BK_ORDER = [BK.connection, BK.local, BK.extra, BK.emergency];
/** Статусы, которые план не перекрывает: закрытые и ждущие решения диспетчера. */
const STICKY_STATUSES = new Set(['done', 'cancelled', 'rescheduled', 'cancel_pending', 'reschedule_pending']);
const SKILL_TYPE_PREFIX = 'skill:';

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toVisit(point: RoutePoint, engineerId: string, coords: Coordinates): DayVisit {
  return {
    requestId: point.request_id,
    engineerId,
    sequence: point.sequence,
    arrival: point.arrival,
    start: point.start,
    end: point.end,
    travelMinutes: numberOr(point.travel_minutes),
    legKm: numberOr(point.leg_distance_km),
    waitingMinutes: numberOr(point.waiting_minutes),
    slackMinutes: point.slack_minutes ?? null,
    frozen: Boolean(point.frozen),
    status: point.status,
    flags: knownFlags(point.flags),
    actualStart: point.actual_start ?? null,
    actualEnd: point.actual_end ?? null,
    point: mapPoint(coords, point.latitude, point.longitude),
  };
}

export interface DayModelInput {
  date: string;
  region: DayRegion;
  /** Сценарий действующей версии (после событий — производный: в нём и новые заявки). */
  scenario: ScenarioOut;
  plan: PlanResponse | null;
  /** Номер версии, предложения и отменённые событиями заявки — из цепочки версий (adapters/dayChain.ts). */
  chain?: Pick<DayChain, 'version' | 'pendingProposals'> & Partial<Pick<DayChain, 'cancelledIds'>> | null;
  /** Запасной путь часов дня: `?clock=HH:MM` в адресе (§7). */
  clockOverride?: string | null;
}

export function buildDayModel({
  date,
  region,
  scenario,
  plan,
  chain,
  clockOverride,
}: DayModelInput): DayModel {
  const requests = scenario.requests ?? [];
  const engineers = scenario.engineers ?? [];
  const office = (region.office ?? scenario.office ?? null) as
    | { lat?: number; lon?: number; address?: string }
    | null;
  const coords = coordinatesFor(requests, engineers, office);
  const { transform } = coords;
  const synthetic = isSynthetic(scenario);
  const colors = engineerColors(engineers.map((e) => e.id));

  // маршруты плана
  const routes: DayRoute[] = [];
  const visitByRequest = new Map<string, DayVisit>();
  for (const route of plan?.routes ?? []) {
    const visits = [...(route.route ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((point) => toVisit(point, route.engineer_id, coords));
    for (const visit of visits) visitByRequest.set(visit.requestId, visit);
    routes.push({
      engineerId: route.engineer_id,
      visits,
      distanceKm: numberOr(route.distance_km),
      taskCount: numberOr(route.task_count, visits.length),
      start: isValidLatLng(route.start_latitude, route.start_longitude)
        ? transform(route.start_latitude as number, route.start_longitude as number)
        : null,
      geometrySource: route.geometry_source ?? null,
    });
  }
  const routeByEngineer = new Map(routes.map((r) => [r.engineerId, r]));

  const dayEngineers: DayEngineer[] = [...engineers]
    .sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }))
    .map((engineer) => {
      const route = routeByEngineer.get(engineer.id);
      const transport = engineer.actual_transport || engineer.transport;
      const own = isValidLatLng(engineer.latitude, engineer.longitude)
        ? transform(engineer.latitude, engineer.longitude)
        : null;
      return {
        id: engineer.id,
        ...engineerLabels(engineer),
        color: colors.get(engineer.id) ?? { index: 1, css: 'var(--route-1)', dashed: false },
        transport,
        transportLabel: transportLabel(transport, engineer.actual_transport ? null : engineer.transport_display),
        skills: engineer.skills ?? [],
        skillLabels: (engineer.skills ?? []).map((s, i) => skillLabel(s, engineer.skills_display?.[i])),
        shiftStart: engineer.shift_start,
        shiftEnd: engineer.shift_end,
        available: engineer.available !== false,
        shiftStatus: engineer.shift_status || 'not_started',
        availableUntil: engineer.available_until ?? null,
        start: route?.start ?? own,
        startKind: engineer.start_kind || 'office',
        taskCount: route?.taskCount ?? 0,
        distanceKm: route?.distanceKm ?? 0,
        used: (route?.visits.length ?? 0) > 0,
        raw: engineer,
      };
    });
  const engineerById = new Map(dayEngineers.map((e) => [e.id, e]));

  // отменённая принятым событием заявка — отменена, даже если бэк вернул её в неназначенные (п. 49)
  const cancelledIds = chain?.cancelledIds ?? new Set<string>();
  const cancelledNow = (id: string) => cancelledIds.has(id) && !visitByRequest.has(id);
  const unassignedIds = new Set((plan?.unassigned ?? []).map((u) => u.request_id));
  const dayRequests: DayRequest[] = requests.map((request) => {
    const visit = visitByRequest.get(request.id) ?? null;
    const labels = requestLabels(request);
    const status =
      visit?.status ??
      (cancelledNow(request.id)
        ? 'cancelled'
        : unassignedIds.has(request.id) && !STICKY_STATUSES.has(request.status)
          ? 'unassigned'
          : request.status);
    const flags = visit ? visit.flags : knownFlags(request.flags);
    const urgent = request.priority === 'urgent' || flags.includes('urgent');
    return {
      id: request.id,
      ...labels,
      windowStart: request.window_start,
      windowEnd: request.window_end,
      windowShort: windowShort(request.window_start, request.window_end),
      windowFull: windowFull(request.window_start, request.window_end),
      durationMinutes: request.duration_minutes,
      skill: request.required_skill,
      skillLabel: skillLabel(request.required_skill, request.required_skill_display),
      requiredTransport: request.required_transport ?? null,
      requiredTransportLabel: request.required_transport
        ? transportLabel(request.required_transport, request.required_transport_display)
        : 'не требуется',
      gigabit: Boolean(request.gigabit),
      technology: request.technology ?? null,
      status: isRequestStatus(status) ? status : status || 'unassigned',
      flags: urgent && !flags.includes('urgent') ? ['urgent', ...flags] : flags,
      urgent,
      emergency: isEmergency(request),
      point: visit?.point ?? mapPoint(coords, request.latitude, request.longitude),
      engineerId: visit?.engineerId ?? null,
      visit,
      dispatcherEngineerId: request.dispatcher_engineer_id ?? null,
      raw: request,
    };
  });
  const requestById = new Map(dayRequests.map((r) => [r.id, r]));

  // CSV-импорт пишет в dispatcher_engineer_id имя бригады, а не id (бэк 28.09) — сопоставляем по имени
  const idByName = new Map(engineers.map((e) => [(e.name ?? '').trim().toLowerCase(), e.id]));
  const knownIds = new Set(engineers.map((e) => e.id));
  for (const request of dayRequests) {
    const raw = request.dispatcherEngineerId;
    if (raw && !knownIds.has(raw)) request.dispatcherEngineerId = idByName.get(raw.trim().toLowerCase()) ?? raw;
  }

  const unassigned: DayUnassigned[] = (plan?.unassigned ?? [])
    .filter((item) => !cancelledNow(item.request_id))
    .map((item) => ({
      requestId: item.request_id,
      reasonCode: item.reason_code,
      reason: item.reason,
    }));

  const explanations = new Map((plan?.explanations ?? []).map((e) => [e.request_id, e]));

  const planState: PlanState =
    region.plan_state ??
    (scenario.active_plan_id ? 'applied' : scenario.draft_plan_id ? 'draft' : 'none');
  const planId =
    plan?.plan_id ??
    region.active_plan_id ??
    region.draft_plan_id ??
    scenario.active_plan_id ??
    scenario.draft_plan_id ??
    null;
  const clock = region.clock ?? scenario.clock ?? clockOverride ?? null;
  const source = (region.source ?? scenario.source ?? '').toLowerCase();
  // при переносе условных координат облако центрируется на офисе — маркер офиса там же
  const officePoint: LatLng | null =
    office && isValidLatLng(office.lat, office.lon) ? [office.lat as number, office.lon as number] : null;

  return {
    date,
    regionId: String(region.region_id),
    scenarioId: scenario.scenario_id,
    planState,
    version: chain ? chain.version : numberOr(region.version ?? plan?.version, 0),
    source,
    fromCsv: source === 'csv' || source === 'demo',
    synthetic,
    coordsApprox: coords.approx,
    transform,
    office: officePoint ? { point: officePoint, address: office?.address?.trim() || null } : null,
    clock,
    now: nowFor(clock),
    planId,
    plan,
    engineers: dayEngineers,
    engineerById,
    requests: dayRequests,
    requestById,
    routes,
    routeByEngineer,
    unassigned,
    explanations,
    axis: timelineAxis(dayEngineers.map((e) => ({ start: e.shiftStart, end: e.shiftEnd }))),
    pendingProposals: chain ? chain.pendingProposals : (region.pending_proposals ?? []),
    typeOptions: typeOptionsOf(dayRequests),
    lastRecalc: region.last_recalc
      ? { at: region.last_recalc.at, requestId: region.last_recalc.request_id ?? null }
      : null,
  };
}

/** Варианты фильтра «Тип заявки»: BK дня, а на синтетике (нет BK) — по навыку (§6.8). */
function typeOptionsOf(requests: readonly DayRequest[]): TypeOption[] {
  const withBk = requests.filter((r) => r.raw.type_bk);
  if (withBk.length > 0) {
    const present = new Set(withBk.map((r) => r.raw.type_bk as string));
    const ordered = BK_ORDER.filter((bk) => present.has(bk));
    const rest = [...present].filter((bk) => !BK_ORDER.includes(bk as (typeof BK_ORDER)[number]));
    return [...ordered, ...rest].map((bk) => ({ value: bk, label: bk }));
  }
  const skills = [...new Set(requests.map((r) => r.skill))];
  return skills.map((skill) => ({
    value: `${SKILL_TYPE_PREFIX}${skill}`,
    label: requests.find((r) => r.skill === skill)?.typeBk ?? skill,
  }));
}

export interface DayFilters {
  status: string | null;
  type: string | null;
}

/** Заявка проходит фильтры «Статус» и «Тип заявки» (по одному значению, D-27). */
export function matchesFilters(request: DayRequest, filters: DayFilters): boolean {
  if (filters.status && request.status !== filters.status) return false;
  if (filters.type) {
    if (filters.type.startsWith(SKILL_TYPE_PREFIX)) {
      if (request.skill !== filters.type.slice(SKILL_TYPE_PREFIX.length)) return false;
    } else if (request.raw.type_bk !== filters.type) {
      return false;
    }
  }
  return true;
}
