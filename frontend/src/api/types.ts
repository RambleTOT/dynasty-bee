/**
 * Типы API. Источник — src/api/schema.d.ts (`npm run gen:types` из живой схемы).
 * Ответы «без схемы» (FRONTEND_SPEC §5.2, §8.3.4) описаны вручную ниже: поля, которых может не
 * быть, — необязательные; адаптеры читают их только через `?.` и значения по умолчанию.
 */
import type { Flag, RegionId, RequestStatus, Transport } from '@/lib/statuses';
import type { components } from './schema';

export type Schemas = components['schemas'];

// --- вход ---
export type UserOut = Schemas['UserOut'];
export type LoginIn = Schemas['LoginIn'];
export type LoginOut = Schemas['LoginOut'];

/** Роль пользователя. В схеме `UserOut.role` — просто string, поэтому union задаём сами. */
export type Role = 'dispatcher' | 'operator' | 'engineer';

// --- справочники и данные дня ---
export type RegionOut = Schemas['RegionOut'];
export type OfficeOut = Schemas['OfficeOut'];

/** Норматив участка (§14): тип заявки BK → навык и длительность работ без дороги, мин. */
export interface RegionNormType {
  type_bk: string;
  skill: string;
  duration_minutes: number;
}

export interface RegionNorms {
  types: RegionNormType[];
}

/**
 * Участок из `GET /regions` с полями §14 (свои участки, `anyRegionEnabled`). У бэка до 29.09 их не
 * было: читаем через `?.`, участок без `builtin` — участок кейса. `norms.types` в схеме
 * необязательное — у своего участка бэк отдаёт его всегда.
 */
export type RegionInfo = Omit<RegionOut, 'builtin' | 'norms' | 'created_at'> & {
  builtin?: boolean;
  norms?: RegionNorms | null;
  created_at?: string | null;
};

/** `POST /regions` (§14): новый участок — название, офис с координатами, нормативы. */
export interface RegionCreate {
  name: string;
  office: OfficeOut;
  norms?: RegionNorms;
}

export type RegionPatch = Partial<RegionCreate>;

/** Бригада ростера участка (`GET|PUT /regions/{id}/roster`, §14) — форма `EngineerIn` бэка. */
export interface RosterEngineer {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  shift_start: string;
  shift_end: string;
  skills: string[];
  transport: string;
  available?: boolean;
}
export type ScenarioOut = Schemas['ScenarioOut'];
export type ScenarioSummary = Schemas['ScenarioSummary'];
export type RequestOut = Schemas['RequestOut'];
export type EngineerOut = Schemas['EngineerOut'];
export type EngineerCreate = Schemas['EngineerCreate'];
export type EngineerPatch = Schemas['EngineerPatch'];

// --- план ---
export type PlanResponse = Schemas['PlanResponse'];
export type PlanSummary = Schemas['PlanSummary'];
export type MetricBlock = Schemas['MetricBlock'];
export type MetricsComparison = Schemas['MetricsComparison'];
export type RouteOut = Schemas['RouteOut'];
export type RoutePoint = Schemas['RoutePoint'];
export type UnassignedOut = Schemas['UnassignedOut'];
export type ExplanationOut = Schemas['ExplanationOut'];
export type PlanListItem = Schemas['PlanListItem'];
export type PlanListResponse = Schemas['PlanListResponse'];
export type PlanVersionResponse = Schemas['PlanVersionResponse'];
export type PlanDiffResponse = Schemas['PlanDiffResponse'];
export type DiffSummary = Schemas['DiffSummary'];
export type EngineerDiff = Schemas['EngineerDiff'];
export type CompareRequest = Schemas['CompareRequest'];
export type CompareResponse = Schemas['CompareResponse'];
export type CompareColumn = Schemas['CompareColumn'];
export type BaselineResponse = Schemas['BaselineResponse'];
export type ReassignRequest = Schemas['ReassignRequest'];
export type ReassignCheckResponse = Schemas['ReassignCheckResponse'];
export type ExtendResourceRequest = Schemas['ExtendResourceRequest'];
export type ExtendResourceResponse = Schemas['ExtendResourceResponse'];
export type ExtendResourceCheckResponse = Schemas['ExtendResourceCheckResponse'];
export type PlanningRunRequest = Schemas['PlanningRunRequest'];

// --- события ---
export type ApplyEventRequest = Schemas['ApplyEventRequest'];
export type ReplanResult = Schemas['ReplanResult'];
export type EventItem = Schemas['EventItem'];

/**
 * Срочная заявка в теле события. В сгенерированном `RequestIn` обязательны и поля со значениями
 * по умолчанию на бэке (docs/API_NOTES.md, п. 4) — шлём только нужные.
 */
export type UrgentRequestIn = Pick<
  Schemas['RequestIn'],
  'id' | 'duration_minutes' | 'window_start' | 'window_end' | 'priority' | 'required_skill'
> &
  Partial<
    Pick<
      Schemas['RequestIn'],
      | 'latitude'
      | 'longitude'
      | 'address'
      | 'required_transport'
      | 'type_bk'
      | 'type_hd'
      | 'district'
      | 'source'
    >
  >;

// --- оператор ---
export type BookingSlotsResponse = Schemas['BookingSlotsResponse'];
export type SlotOut = Schemas['SlotOut'];
export type BookingRequestIn = Schemas['BookingRequestIn'];
export type BookingRequestOut = Schemas['BookingRequestOut'];
export type BookingRescheduleIn = Schemas['BookingRescheduleIn'];

// --- инженер ---
export type EngineerActionOut = Schemas['EngineerActionOut'];
export type EngineerVisitSchema = Schemas['EngineerVisit'];

export type EngineerAction =
  | 'shift_start'
  | 'en_route'
  | 'start'
  | 'complete'
  | 'fail'
  | 'unavailable'
  | 'shift_end'
  | 'incident'
  /** Смена транспорта без инцидента — предложение диспетчеру (после «Начать смену» с другим). */
  | 'transport_changed';

export interface EngineerActionIn {
  action: EngineerAction;
  request_id?: string;
  /** `at` не шлём: время берёт бэк по часам дня (FRONTEND_SPEC §7). */
  payload?: Record<string, unknown>;
}

// ============ ручные типы ответов без схемы (§5.2) ============

export interface CalendarDay {
  date: string;
  request_count: number;
  by_status?: Partial<Record<RequestStatus, number>>;
  flags?: Partial<Record<Flag, number>>;
  sources?: string[];
}

export interface CalendarResponse {
  days: CalendarDay[];
}

export type PlanState = 'none' | 'draft' | 'applied';

export interface PendingProposal {
  plan_id: string;
  event_id?: string | null;
  headline?: string | null;
  event_type?: string | null;
  created_at?: string | null;
}

export interface DayRegion {
  region_id: RegionId | string;
  name?: string;
  scenario_id?: string | null;
  source?: string | null;
  office?: OfficeOut | null;
  active_plan_id?: string | null;
  draft_plan_id?: string | null;
  plan_state?: PlanState;
  version?: number | null;
  pending_proposals?: PendingProposal[];
  last_recalc?: { at: string; request_id?: string | null } | null;
  /** ⏳ D-24: часы дня. */
  clock?: string | null;
}

export interface DayResponse {
  date: string;
  regions: DayRegion[];
}

/** Ответ /planning/{id}/requests/{rid}: заявка, визит, объяснение и флаги одним запросом. */
export interface PlanRequestDetails {
  request?: RequestOut;
  visit?: RoutePoint | null;
  explanation?: ExplanationOut | null;
  flags?: string[];
  engineer?: Partial<EngineerOut> | null;
}

export interface ClockOut {
  scenario_id: string;
  clock: string | null;
  real_now?: string;
}

/** GeoJSON маршрутов: координаты — [lon, lat] (FRONTEND_SPEC §6.6). */
export interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString' | 'Point' | 'MultiLineString' | string;
    coordinates: unknown;
  } | null;
  properties?: Record<string, unknown> | null;
}

export interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

// --- инженер (§5.2) ---
export type ShiftStatus = 'not_started' | 'on_shift' | 'unavailable' | 'finished';

export interface EngineerVisit extends EngineerVisitSchema {
  /** ⏳ 8.6 */
  actual_start?: string | null;
  actual_end?: string | null;
  // equipment (8.8) — уже в схеме
}

export interface EngineerBanner {
  type: string;
  text: string;
  at?: string | null;
  request_id?: string | null;
}

export interface EngineerShiftTotals {
  done?: number;
  total?: number;
  started_in_window?: number;
  km?: number;
  minutes_travel?: number;
  minutes_work?: number;
  minutes_wait?: number;
  interrupted?: number;
  /** ⏳ 8.7 */
  started_at?: string | null;
  ended_at?: string | null;
}

export interface EngineerMeDay {
  date?: string;
  plan_published?: boolean;
  /** ⏳ §1 */
  clock?: string | null;
  engineer: {
    id: string;
    name?: string;
    transport?: Transport | string;
    actual_transport?: Transport | string | null;
    shift_start?: string;
    shift_end?: string;
    shift_status?: ShiftStatus | string;
    available_until?: string | null;
    start?: { kind?: string; address?: string | null; lat?: number; lon?: number } | null;
    /** ⏳ 8.9 P2 */
    color_index?: number | null;
  };
  summary: { total?: number; done?: number; km_planned?: number; first_start?: string | null };
  active_request_id?: string | null;
  visits?: EngineerVisit[];
  banners?: EngineerBanner[];
  shift_totals?: EngineerShiftTotals | null;
}

export interface EngineerRoute {
  transport?: Transport | string;
  start?: { lat: number; lon: number; label?: string } | null;
  points?: { request_id: string; sequence: number; lat: number; lon: number; address?: string }[];
  geometry?: { type: 'LineString'; coordinates: [number, number][] } | null;
}

// --- оператор (§8.3.4) ---
export interface BookingSearchItem {
  request_id: string;
  region_id: RegionId | string;
  date: string;
  window: string;
  address?: string | null;
  type_bk?: string | null;
  type_hd?: string | null;
  status: RequestStatus | string;
  /** ⏳ 9.2 */
  district?: string | null;
  gigabit?: boolean | null;
  technology?: 'FMC' | 'FTTB' | string | null;
  required_transport?: Transport | string | null;
  engineer_name?: string | null;
}

export type CancelReason = 'client_refused' | 'booking_error' | 'other';

export interface BookingCancelBody {
  reason: CancelReason;
  /** ⏳ 9.3 */
  comment?: string;
}

/** Ответы записи, отмены, переноса — поля сверх схемы (⏳ 9.4). */
export interface BookingMutationResult {
  status?: string;
  message?: string;
  request_id?: string;
  date?: string;
  window?: string;
}

/** Отчёт импорта CSV (ScenarioSummary.import_report) — форма по снимку, читаем безопасно. */
export type ImportReport = Record<string, unknown>;
