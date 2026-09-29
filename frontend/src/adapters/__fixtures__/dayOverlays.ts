/**
 * День для тестов окон DS-05, DS-08, DS-09, DS-10: CSV-день Востока, 5 бригад, 7 заявок, план P1.
 * Собран из фабрик `day.ts` по форме живых ответов бэка. Только для тестов: в коде приложения не импортировать.
 */
import type { BaselineResponse, CompareResponse, EngineerOut, RequestOut } from '@/api/types';
import { buildDayModel, type DayModel } from '../dayModel';
import {
  makeEngineer,
  makePlan,
  makePoint,
  makeRegion,
  makeRequest,
  makeRoute,
  makeScenario,
} from './day';

export const overlayEngineers: EngineerOut[] = [
  makeEngineer({ id: 'e1', name: 'Бригада Соколов', latitude: 55.74, longitude: 37.8 }),
  makeEngineer({
    id: 'e2',
    name: 'Бригада Мельников',
    skills: ['installation', 'local'],
    skills_display: ['Подключение и дозаказ', 'Локальные работы'],
    latitude: 55.752,
    longitude: 37.8,
  }),
  makeEngineer({
    id: 'e3',
    name: 'Бригада Попов',
    skills: ['local'],
    skills_display: ['Локальные работы'],
    transport: 'public_transport',
    transport_display: 'Общественный транспорт',
  }),
  makeEngineer({
    id: 'e4',
    name: 'Бригада Перов',
    skills: ['installation', 'local'],
    skills_display: ['Подключение и дозаказ', 'Локальные работы'],
    transport: 'walk',
    transport_display: 'Пешком',
    latitude: 55.751,
    longitude: 37.8,
  }),
  makeEngineer({
    id: 'e5',
    name: 'Бригада Каушнян',
    skills: ['installation'],
    skills_display: ['Подключение и дозаказ'],
    transport: 'public_transport',
    transport_display: 'Общественный транспорт',
    available: false,
  }),
];

const local = {
  type_bk: 'Локальная заявка',
  type_hd: 'Нет линка',
  required_skill: 'local',
  required_skill_display: 'Локальные работы',
};

export const overlayRequests: RequestOut[] = [
  makeRequest({
    id: '305800001',
    window_start: '10:00',
    window_end: '12:00',
    dispatcher_engineer_id: 'e1',
  }),
  makeRequest({
    id: '305800002',
    window_start: '12:00',
    window_end: '14:00',
    required_transport: 'car',
    required_transport_display: 'Автомобиль',
    address: 'ул. Шоссейная, д. 42',
    dispatcher_engineer_id: 'e2',
  }),
  makeRequest({
    id: '305800003',
    ...local,
    window_start: '14:00',
    window_end: '16:00',
    dispatcher_engineer_id: 'e2',
  }),
  makeRequest({
    id: '305800004',
    ...local,
    window_start: '12:00',
    window_end: '14:00',
    dispatcher_engineer_id: 'e3',
  }),
  {
    ...makeRequest({ id: '305800005', status: 'cancelled' }),
    cancel_reason: 'client_refused',
  } as RequestOut,
  {
    ...makeRequest({ id: '305800006', status: 'rescheduled' }),
    rescheduled_to: '2026-10-01',
  } as RequestOut,
  makeRequest({
    id: '305800007',
    type_bk: 'Глобальная проблема',
    type_hd: 'Авария',
    required_skill: 'emergency',
    required_skill_display: 'Аварийные работы',
    required_transport: 'car',
    window_start: '18:00',
    window_end: '20:00',
  }),
];

export const overlayPlan = makePlan({
  plan_id: 'P1',
  summary: {
    engineers_used: 2,
    total_distance_km: 18.6,
    planned_count: 4,
    total_requests: 7,
    unassigned_count: 1,
    unassigned_urgent: 0,
    objective: [],
  },
  routes: [
    makeRoute(
      'e1',
      [
        makePoint({
          request_id: '305800001',
          sequence: 1,
          arrival: '10:05',
          start: '10:05',
          end: '11:15',
          status: 'done',
          actual_start: '10:10',
          actual_end: '11:00',
          travel_minutes: 15,
          leg_distance_km: 4.1,
          frozen: true,
        }),
        makePoint({
          request_id: '305800002',
          sequence: 2,
          arrival: '12:20',
          start: '12:30',
          end: '13:40',
          window_start: '12:00',
          window_end: '14:00',
          travel_minutes: 20,
          waiting_minutes: 10,
          leg_distance_km: 5.2,
        }),
      ],
      { distance_km: 8.4, start_latitude: 55.74, start_longitude: 37.8 },
    ),
    makeRoute(
      'e2',
      [
        makePoint({
          request_id: '305800003',
          sequence: 1,
          start: '15:10',
          end: '15:40',
          window_start: '14:00',
          window_end: '16:00',
          required_skill: 'local',
          travel_minutes: 25,
          latitude: 55.76,
          longitude: 37.81,
        }),
        makePoint({
          request_id: '305800004',
          sequence: 2,
          start: '16:00',
          end: '16:30',
          window_start: '12:00',
          window_end: '14:00',
          required_skill: 'local',
          travel_minutes: 10,
          flags: ['late'],
          latitude: 55.77,
          longitude: 37.81,
        }),
      ],
      { distance_km: 10.2, start_latitude: 55.752, start_longitude: 37.8 },
    ),
  ],
  unassigned: [
    {
      request_id: '305800007',
      reason_code: 'NO_CAPACITY',
      reason: 'Нет свободных.',
      proven_static: false,
    },
  ],
});

export const overlayScenario = makeScenario({
  engineers: overlayEngineers,
  requests: overlayRequests,
});

export function overlayModel(
  patch: { planState?: 'none' | 'draft' | 'applied'; version?: number } = {},
): DayModel {
  const planState = patch.planState ?? 'applied';
  const hasPlan = planState !== 'none';
  return buildDayModel({
    date: '2026-09-29',
    region: makeRegion({
      active_plan_id: planState === 'applied' ? 'P1' : null,
      draft_plan_id: planState === 'draft' ? 'P1' : null,
      plan_state: planState,
      version: patch.version ?? (planState === 'applied' ? 4 : 0),
    }),
    scenario: overlayScenario,
    plan: hasPlan ? overlayPlan : null,
    clockOverride: '14:32',
  });
}

/** Ответ `POST /planning/compare {strategies: ['fifo', 'dispatcher']}`; «Наш план» — сводка плана. */
export const overlayCompare = {
  columns: {
    fifo: {
      available: true,
      engineers_used: 3,
      km_total: 25,
      coverage_pct: 71.4,
      unassigned_urgent: 0,
      violations: 0,
      km_is_estimate: false,
    },
    dispatcher: {
      available: true,
      engineers_used: 3,
      km_total: 27.6,
      coverage_pct: 100,
      unassigned_urgent: 0,
      violations: 0,
      km_is_estimate: true,
    },
  },
  km_by_engineer: { dispatcher: { e1: 9.1, e2: 11.3, e3: 7.2 } },
  notes: [],
} as unknown as CompareResponse;

export const overlayBaseline = {
  plan_id: 'P1',
  baseline: {
    engineers_used: 3,
    total_distance_km: 25,
    planned_count: 4,
    total_requests: 7,
    unassigned_count: 2,
    unassigned_urgent: 0,
  },
  baseline_routes: [
    makeRoute('e1', [makePoint({ request_id: '305800001', sequence: 1, start: '10:20' })], {
      distance_km: 8,
    }),
    makeRoute(
      'e2',
      [
        makePoint({
          request_id: '305800002',
          sequence: 1,
          start: '14:30',
          window_start: '12:00',
          window_end: '14:00',
        }),
        makePoint({
          request_id: '305800003',
          sequence: 2,
          start: '15:30',
          window_start: '14:00',
          window_end: '16:00',
        }),
      ],
      { distance_km: 9.5 },
    ),
    makeRoute(
      'e3',
      [
        makePoint({
          request_id: '305800004',
          sequence: 1,
          start: '14:40',
          window_start: '12:00',
          window_end: '14:00',
        }),
      ],
      { distance_km: 6.5 },
    ),
  ],
} as unknown as BaselineResponse;
