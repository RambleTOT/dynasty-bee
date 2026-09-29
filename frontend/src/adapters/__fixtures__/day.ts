/**
 * Фикстуры для тестов адаптеров — по форме живых ответов бэка (исходники бэка 28.09).
 * Только для тестов: в коде приложения не импортировать.
 */
import type {
  DayRegion,
  EngineerOut,
  EventItem,
  PlanListItem,
  PlanResponse,
  RequestOut,
  RouteOut,
  RoutePoint,
  ScenarioOut,
} from '@/api/types';

export function makeRequest(patch: Partial<RequestOut> & { id: string }): RequestOut {
  return {
    latitude: 55.75,
    longitude: 37.8,
    address: 'Город Москва, улица Вешняковская, дом 18',
    duration_minutes: 70,
    window_start: '10:00',
    window_end: '12:00',
    priority: 'normal',
    required_skill: 'installation',
    required_skill_display: 'Подключение и дозаказ',
    required_transport: null,
    required_transport_display: null,
    min_skill_level: 1,
    type_bk: 'Подключение',
    type_hd: 'Конвергенция абонента',
    district: 'Вешняки',
    gigabit: false,
    technology: 'FTTB',
    priority_rank: 2,
    source: 'csv',
    client_window_locked: false,
    status: 'planned',
    flags: [],
    ...patch,
  };
}

export function makeEngineer(patch: Partial<EngineerOut> & { id: string }): EngineerOut {
  return {
    name: `Бригада ${patch.id}`,
    latitude: 55.72,
    longitude: 37.82,
    shift_start: '10:00',
    shift_end: '22:00',
    skills: ['local', 'installation', 'emergency'],
    skills_display: ['Локальные работы', 'Подключение и дозаказ', 'Аварийные работы'],
    transport: 'car',
    transport_display: 'Автомобиль',
    available: true,
    start_kind: 'office',
    shift_status: 'not_started',
    assigned_tasks: 0,
    distance_km: 0,
    ...patch,
  };
}

export function makePoint(patch: Partial<RoutePoint> & { request_id: string; sequence: number }): RoutePoint {
  return {
    latitude: 55.75,
    longitude: 37.8,
    arrival: '10:05',
    start: '10:05',
    end: '11:15',
    travel_minutes: 12,
    leg_distance_km: 3.2,
    waiting_minutes: 0,
    window_start: '10:00',
    window_end: '12:00',
    required_skill: 'installation',
    required_skill_display: 'Подключение и дозаказ',
    status: 'planned',
    flags: [],
    slack_minutes: 45,
    frozen: false,
    ...patch,
  };
}

export function makeRoute(
  engineerId: string,
  points: RoutePoint[],
  patch: Partial<RouteOut> = {},
): RouteOut {
  return {
    engineer_id: engineerId,
    engineer_name: `Бригада ${engineerId}`,
    transport: 'car',
    transport_display: 'Автомобиль',
    skills: ['installation'],
    skills_display: ['Подключение и дозаказ'],
    shift_start: '10:00',
    shift_end: '22:00',
    start_latitude: 55.72,
    start_longitude: 37.82,
    distance_km: points.reduce((sum, p) => sum + p.leg_distance_km, 0),
    task_count: points.length,
    route: points,
    geometry_source: 'local_osrm:car',
    explanation: '',
    ...patch,
  };
}

export function makePlan(patch: Partial<PlanResponse> & { plan_id: string }): PlanResponse {
  return {
    scenario_id: 'S0',
    parent_plan_id: null,
    kind: 'optimized',
    status: 'applied',
    version: 1,
    strategy: 'hybrid_v2',
    created_at: '2026-09-28T09:05:00+00:00',
    summary: {
      engineers_used: 1,
      total_distance_km: 3.2,
      planned_count: 1,
      total_requests: 1,
      unassigned_count: 0,
      unassigned_urgent: 0,
      objective: [0, 0, 0, 0],
    },
    routes: [],
    unassigned: [],
    explanations: [],
    ...patch,
  };
}

export function makeScenario(patch: Partial<ScenarioOut> = {}): ScenarioOut {
  return {
    scenario_id: 'S0',
    name: 'Восток · 2026-09-28 · CSV',
    created_at: '2026-09-28T07:00:00+00:00',
    region_id: 'east',
    date: '2026-09-28',
    source: 'csv',
    office: { address: 'Москва, Вешняковская, 18', lat: 55.72, lon: 37.82 },
    engineers: [],
    requests: [],
    ...patch,
  };
}

export function makeRegion(patch: Partial<DayRegion> = {}): DayRegion {
  return {
    region_id: 'east',
    name: 'Восток',
    scenario_id: 'S0',
    source: 'csv',
    office: { address: 'Москва, Вешняковская, 18', lat: 55.72, lon: 37.82 },
    active_plan_id: null,
    draft_plan_id: null,
    plan_state: 'none',
    version: 0,
    pending_proposals: [],
    last_recalc: null,
    ...patch,
  };
}

export function makeEvent(patch: Partial<EventItem> & { event_id: string }): EventItem {
  return {
    event_type: 'urgent_order_added',
    plan_id: null,
    scenario_id: 'S0',
    result_plan_id: null,
    payload: {},
    needs_decision: false,
    created_at: '2026-09-28T10:00:00+00:00',
    ...patch,
  };
}

export function makePlanItem(patch: Partial<PlanListItem> & { plan_id: string }): PlanListItem {
  return {
    scenario_id: 'S0',
    kind: 'optimized',
    status: 'applied',
    version: 0,
    created_at: '2026-09-28T09:05:00+00:00',
    engineers_used: 3,
    total_distance_km: 42.3,
    planned_count: 20,
    ...patch,
  };
}
