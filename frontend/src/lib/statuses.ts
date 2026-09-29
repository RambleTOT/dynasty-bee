/**
 * Статусы заявки и флаги: подписи, тоны и иконки — дословно по FRONTEND_SPEC §10.1 и DESIGN_SPEC §2.4, §5.
 * Статусы и флаги в интерфейсе берём только отсюда (правила проекта); TASK_STATUS дизайн-системы не используем.
 */
import {
  AlarmClockOff,
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClockAlert,
  Navigation,
  RefreshCw,
  Timer,
  TimerReset,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Тон чипа: цвет текста `--st-{tone}` на подложке `--st-{tone}-bg`. */
export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'changed' | 'neutral';

export const REQUEST_STATUSES = [
  'unassigned',
  'planned',
  'en_route',
  'in_progress',
  'done',
  'cancel_pending',
  'cancelled',
  'reschedule_pending',
  'rescheduled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  unassigned: 'Не назначена',
  planned: 'Запланирована',
  en_route: 'В пути',
  in_progress: 'В работе',
  done: 'Выполнена',
  cancel_pending: 'Отменяется',
  cancelled: 'Отменена',
  reschedule_pending: 'Переносится',
  rescheduled: 'Перенесена',
};

export const REQUEST_STATUS_TONE: Record<RequestStatus, StatusTone> = {
  unassigned: 'danger',
  planned: 'neutral',
  en_route: 'info',
  in_progress: 'info',
  done: 'success',
  cancel_pending: 'warning',
  cancelled: 'neutral',
  reschedule_pending: 'warning',
  rescheduled: 'neutral',
};

export const REQUEST_STATUS_ICON: Record<RequestStatus, LucideIcon> = {
  unassigned: CircleAlert,
  planned: CircleDashed,
  en_route: Navigation,
  in_progress: Wrench,
  done: CircleCheck,
  cancel_pending: ClockAlert,
  cancelled: CircleX,
  reschedule_pending: CalendarClock,
  rescheduled: CalendarCheck,
};

/** Порядок сегментов полосы в ячейке календаря (FRONTEND_SPEC §8.2 DS-01): без отменённых и перенесённых. */
export const CALENDAR_BAR_STATUSES: readonly RequestStatus[] = [
  'done',
  'in_progress',
  'en_route',
  'planned',
  'cancel_pending',
  'reschedule_pending',
  'unassigned',
];

/** Заявка ждёт решения диспетчера (D-29). */
export const PENDING_STATUSES: readonly RequestStatus[] = ['cancel_pending', 'reschedule_pending'];

/** Заявка закрыта: у инженера — блок «Завершённые». */
export const CLOSED_STATUSES: readonly RequestStatus[] = ['done', 'cancelled', 'rescheduled'];

export const FLAGS = [
  'urgent',
  'at_risk',
  'late',
  'changed',
  'started_early',
  'reaction_late',
] as const;
export type Flag = (typeof FLAGS)[number];

export const FLAG_LABEL: Record<Flag, string> = {
  urgent: 'Срочная',
  at_risk: 'Под угрозой',
  late: 'Просрочена',
  changed: 'Изменено',
  started_early: 'Начата раньше окна',
  reaction_late: 'Реакция > 2 ч',
};

export const FLAG_TONE: Record<Flag, StatusTone> = {
  urgent: 'danger',
  at_risk: 'warning',
  late: 'danger',
  changed: 'changed',
  started_early: 'neutral',
  reaction_late: 'danger',
};

export const FLAG_ICON: Record<Flag, LucideIcon> = {
  urgent: Zap,
  at_risk: ClockAlert,
  late: AlarmClockOff,
  changed: RefreshCw,
  started_early: TimerReset,
  reaction_late: Timer,
};

export const SKILLS = ['local', 'installation', 'emergency'] as const;
export type Skill = (typeof SKILLS)[number];

export const SKILL_LABEL: Record<Skill, string> = {
  local: 'Локальные работы',
  installation: 'Подключение и дозаказ',
  emergency: 'Аварийные работы',
};

export const TRANSPORTS = ['car', 'public_transport', 'walk', 'bike'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const TRANSPORT_LABEL: Record<Transport, string> = {
  car: 'Автомобиль',
  public_transport: 'Общественный транспорт',
  walk: 'Пешком',
  bike: 'Велосипед',
};

export const REGIONS = ['east', 'south_east', 'south_center'] as const;
export type RegionId = (typeof REGIONS)[number];

export const REGION_LABEL: Record<RegionId, string> = {
  east: 'Восток',
  south_east: 'Юго-восток',
  south_center: 'Югоцентр',
};

const has = (list: readonly string[], value: unknown): boolean =>
  typeof value === 'string' && list.includes(value);

export const isRequestStatus = (value: unknown): value is RequestStatus =>
  has(REQUEST_STATUSES, value);
export const isFlag = (value: unknown): value is Flag => has(FLAGS, value);
export const isSkill = (value: unknown): value is Skill => has(SKILLS, value);
export const isTransport = (value: unknown): value is Transport => has(TRANSPORTS, value);
export const isRegionId = (value: unknown): value is RegionId => has(REGIONS, value);

/** Только известные флаги, без повторов: бэк может прислать незнакомый — его не показываем. */
export function knownFlags(flags: readonly unknown[] | null | undefined): Flag[] {
  return [...new Set((flags ?? []).filter(isFlag))];
}

/** Подпись по справочнику. Незнакомое значение с бэка показываем как есть, пустое — ''. */
export function labelOf<K extends string>(
  labels: Record<K, string>,
  value: string | null | undefined,
): string {
  if (!value) return '';
  return Object.hasOwn(labels, value) ? labels[value as K] : value;
}
