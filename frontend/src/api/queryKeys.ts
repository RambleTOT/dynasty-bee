/** Фильтры календаря в ключе запроса — по одному значению (D-27). */
export interface CalendarKeyFilters {
  region?: string;
  status?: string;
  type?: string;
}

/**
 * Ключи react-query. Первые элементы — префиксы для инвалидации после мутаций (FRONTEND_SPEC §5.3):
 * `invalidateQueries({ queryKey: ['days', date] })` задевает день во всех регионах.
 */
export const queryKeys = {
  me: ['me'] as const,
  regions: ['regions'] as const,
  /** Ростер своего участка (§14): под префиксом участков — инвалидируется вместе со списком. */
  regionRoster: (regionId: string) => ['regions', regionId, 'roster'] as const,
  calendar: (month: string, filters: CalendarKeyFilters = {}) =>
    ['calendar', month, filters] as const,
  days: (date: string, region = 'all') => ['days', date, region] as const,
  scenario: (id: string) => ['scenario', id] as const,
  /** Ростер дня (DS-09): под префиксом сценария — инвалидируется вместе с ним. */
  scenarioEngineers: (id: string) => ['scenario', id, 'engineers'] as const,
  plan: (id: string) => ['plan', id] as const,
  planList: (scenarioId: string) => ['plan', 'list', scenarioId] as const,
  planRequest: (planId: string, requestId: string) =>
    ['plan', planId, 'request', requestId] as const,
  geojson: (planId: string) => ['plan', planId, 'geojson'] as const,
  diff: (planId: string, againstId: string) => ['plan', planId, 'diff', againstId] as const,
  baseline: (planId: string) => ['plan', planId, 'baseline'] as const,
  compare: (target: string) => ['compare', target] as const,
  extendResource: (planId: string, orderIds: string) =>
    ['plan', planId, 'extend', orderIds] as const,
  reassignCheck: (
    planId: string,
    orderId: string,
    engineerId: string,
    position: number | null,
    time: string | null = null,
  ) => ['plan', planId, 'reassign', orderId, engineerId, position, time] as const,
  events: (scenarioId: string) => ['events', scenarioId] as const,
  clock: (scenarioId: string) => ['clock', scenarioId] as const,
  engineerDay: () => ['engineerDay'] as const,
  engineerRoute: () => ['engineerRoute'] as const,
  bookingSearch: (q: string) => ['booking', 'search', q] as const,
  bookingSlots: (params: Record<string, unknown>) => ['booking', 'slots', params] as const,
};
