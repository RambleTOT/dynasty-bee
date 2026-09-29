/** Адреса экранов инженера (FRONTEND_SPEC §4). Шторки — query `sheet=…`, не роуты. */
export const ENGINEER_HOME = '/engineer';

/** Карточка заявки: E-03.1 / E-05. */
export const visitPath = (id: string) => `/engineer/request/${encodeURIComponent(id)}`;
