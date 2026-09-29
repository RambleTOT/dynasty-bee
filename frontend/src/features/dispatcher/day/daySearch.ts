/** Состояние экрана дня в адресе (FRONTEND_SPEC §4): фильтры, вид, вкладка и открытые панели. */
import { searchParam } from '@/hooks/useSearchState';

export const DAY_VIEWS = ['map', 'timeline'] as const;
export type DayView = (typeof DAY_VIEWS)[number];

export const DAY_TABS = ['cmp', 'un', 'feed', 'ver'] as const;
export type DayTab = (typeof DAY_TABS)[number];

export const EVENT_TABS = ['urgent', 'cancel', 'off'] as const;
export type EventTab = (typeof EVENT_TABS)[number];

export const daySearch = {
  region: searchParam.string(),
  view: searchParam.enum(DAY_VIEWS, 'map'),
  tab: searchParam.enum(DAY_TABS, 'cmp'),
  status: searchParam.string(),
  type: searchParam.string(),
  /** Фильтр бригады по чипу. */
  brigade: searchParam.string(),
  /** DS-04: карточка заявки. */
  request: searchParam.string(),
  /** DS-04 с карты: заявка в диалоге (клик по маркеру). */
  pin: searchParam.string(),
  /** Неназначенная, к которой прокрутить вкладку «Неназначенные». */
  focus: searchParam.string(),
  /** DS-06: вкладка формы события; `order` — заявка для «Отмены» из карточки. */
  event: searchParam.enum(EVENT_TABS),
  order: searchParam.string(),
  /** DS-07: предложение (план); `against` — режим просмотра двух версий из «Версий». */
  proposal: searchParam.string(),
  against: searchParam.string(),
  /** DS-05 на весь экран. */
  compare: searchParam.enum(['1']),
  /** DS-08: заявка для ручного переназначения; `base` — план, от которого переназначаем. */
  reassign: searchParam.string(),
  base: searchParam.string(),
  /** DS-09 «Состав и ресурсы»; `add=1` — сразу с формой добавления. */
  roster: searchParam.enum(['1']),
  add: searchParam.enum(['1']),
  /** DS-10 «Итоги дня». */
  summary: searchParam.enum(['1']),
  /** Запасной путь часов дня (§7): `?clock=HH:MM`. */
  clock: searchParam.string(),
};

export type DaySearch = typeof daySearch;

/** Закрыть все панели разом (переход по дням, смена региона). */
export const CLOSED_PANELS = {
  request: null,
  pin: null,
  focus: null,
  event: null,
  order: null,
  proposal: null,
  against: null,
  compare: null,
  reassign: null,
  base: null,
  roster: null,
  add: null,
  summary: null,
} as const;
