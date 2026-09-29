/** Планирование: расчёт, версии, diff, сравнение, FIFO, переназначение, ресурсы (FRONTEND_SPEC §5.3). */
import { api } from './client';
import type {
  BaselineResponse,
  CompareResponse,
  ExtendResourceCheckResponse,
  ExtendResourceResponse,
  PlanDiffResponse,
  PlanListResponse,
  PlanRequestDetails,
  PlanResponse,
  PlanVersionResponse,
  ReassignCheckResponse,
  ReplanResult,
} from './types';

type Signal = AbortSignal | undefined;

/** «Построить план»: расчёт (для CSV-дня затем сразу apply, D-25). */
export const runPlan = (scenarioId: string) =>
  api.post<PlanResponse>('/planning/run', {
    scenario_id: scenarioId,
    seed: 42,
    include_baseline: true,
  });

/** Геометрию маршрутов плана не берём (карта — из GeoJSON), поэтому `straight`: так быстрее. */
export const getPlan = (planId: string, signal?: Signal) =>
  api.get<PlanResponse>(`/planning/${planId}`, { query: { geometry: 'straight' }, signal });

/**
 * Список планов. Без `scenarioId` — последние планы всех сценариев: версии после событий живут
 * в производных сценариях, поэтому цепочку версий дня собираем по общему списку (docs/API_NOTES.md).
 */
export const listPlans = (scenarioId?: string | null, signal?: Signal, limit = 200) =>
  api.get<PlanListResponse>('/planning', {
    query: { scenario_id: scenarioId ?? undefined, limit },
    signal,
  });

export const applyPlan = (planId: string) =>
  api.post<PlanVersionResponse>(`/planning/${planId}/apply`);

export const rejectPlan = (planId: string) =>
  api.post<PlanVersionResponse>(`/planning/${planId}/reject`);

export const getPlanDiff = (planId: string, againstId: string, signal?: Signal) =>
  api.get<PlanDiffResponse>(`/planning/${planId}/diff`, { query: { against: againstId }, signal });

/**
 * `plan` — метрики действующего плана тем же расчётом, что FIFO и диспетчер (P1-8, флаг
 * `comparePlanStrategy`); `incremental` на бэке 28.09 отдаёт нули.
 */
export type CompareStrategy = 'ours' | 'fifo' | 'dispatcher' | 'incremental' | 'plan';

/**
 * Сравнение стратегий. `scenario_id` обязателен: без него бэк берёт последний загруженный сценарий
 * (любого дня). `plan_id` — для `incremental`.
 */
export const comparePlans = (
  target: { scenario_id: string; plan_id?: string | null },
  strategies: CompareStrategy[],
) =>
  api.post<CompareResponse>('/planning/compare', {
    scenario_id: target.scenario_id,
    ...(target.plan_id ? { plan_id: target.plan_id } : {}),
    strategies,
  });

/** Базовый FIFO — только ради `baseline_routes` (FRONTEND_SPEC §6.3). */
export const getBaseline = (planId: string) =>
  api.post<BaselineResponse>('/planning/baseline', { plan_id: planId });

export const getPlanRequest = (planId: string, requestId: string, signal?: Signal) =>
  api.get<PlanRequestDetails>(`/planning/${planId}/requests/${encodeURIComponent(requestId)}`, {
    signal,
  });

export interface ReassignBody {
  order_id: string;
  to_engineer_id: string;
  position?: number | null;
  force?: boolean;
  /** «Сейчас» дня: визит не раньше (BACKEND_REQUESTS п. 47, флаг `reassignTime`). */
  time?: string;
}

export const checkReassign = (planId: string, body: ReassignBody, signal?: Signal) =>
  api.post<ReassignCheckResponse>(
    `/planning/${planId}/reassign/check`,
    { ...body, force: body.force ?? false },
    { signal },
  );

export const reassign = (planId: string, body: ReassignBody) =>
  api.post<ReplanResult>(`/planning/${planId}/reassign`, { ...body, force: body.force ?? false });

/**
 * Бригада-кандидат для «кого не хватает»: без неё бэк на `add_engineer` отвечает 422 («передайте
 * инженера в params.engineer»). Координаты старта обязательны — точка офиса.
 */
export interface ExtraEngineer {
  id: string;
  name: string;
  skills: string[];
  transport: string;
  shift_start: string;
  shift_end: string;
  latitude: number;
  longitude: number;
  start_kind: 'office';
}

/**
 * Рекомендация «не хватает +N инженера» на бэке без P1-5: `apply: false` всё равно сохраняет
 * предложение — его и открываем в DS-07.
 */
export const extendResource = (planId: string, orderIds: string[], engineer: ExtraEngineer) =>
  api.post<ExtendResourceResponse>(`/planning/${planId}/extend-resource`, {
    order_ids: orderIds,
    option: 'add_engineer',
    params: { engineer },
    apply: false,
  });

/** P1-5: тот же расчёт без сохранения версии и события (флаг `extendResourceCheck`). */
export const checkExtendResource = (planId: string, orderIds: string[], engineer: ExtraEngineer) =>
  api.post<ExtendResourceCheckResponse>(`/planning/${planId}/extend-resource/check`, {
    order_ids: orderIds,
    option: 'add_engineer',
    params: { engineer },
  });
