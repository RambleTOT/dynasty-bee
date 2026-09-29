/**
 * Тексты объяснений (DESIGN_SPEC §7.1, §7.2): причина неназначения, «Что поможет», транспорт в падежах.
 * Клиентское окно не двигаем — «сдвинуть окно» не предлагаем (Q35).
 */
import {
  Car,
  CircleAlert,
  Clock,
  GraduationCap,
  Package,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** «Нужен автомобиль». */
export const TRANSPORT_NEED: Record<string, string> = {
  car: 'автомобиль',
  public_transport: 'общественный транспорт',
  bike: 'велосипед',
  walk: 'пеший маршрут',
};

/** «бригада на автомобиле», «бригада пешком». */
export const TRANSPORT_ON: Record<string, string> = {
  car: 'на автомобиле',
  public_transport: 'на общественном транспорте',
  bike: 'на велосипеде',
  walk: 'пешком',
};

/** «едет на автомобиле», «идёт пешком». */
export const TRANSPORT_MOVE: Record<string, string> = {
  car: 'едет на автомобиле',
  public_transport: 'едет на общественном транспорте',
  bike: 'едет на велосипеде',
  walk: 'идёт пешком',
};

export const transportNeed = (t: string | null | undefined) => (t ? (TRANSPORT_NEED[t] ?? t) : '');
export const transportOn = (t: string | null | undefined) => (t ? (TRANSPORT_ON[t] ?? t) : '');
export const transportMove = (t: string | null | undefined) => (t ? (TRANSPORT_MOVE[t] ?? t) : '');

interface ReasonTemplate {
  icon: LucideIcon;
  /** Шаблон причины; `null` — берём текст бэка. */
  reason: ((ctx: ReasonContext) => string) | null;
  help: string | null;
}

export interface ReasonContext {
  skill: string;
  transport: string | null;
  window: string;
  /** Подходящие по навыку и транспорту бригады — для NO_CAPACITY. */
  names: string[];
}

const namesText = (names: string[]) =>
  names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}`;

const REASONS: Record<string, ReasonTemplate> = {
  NO_SKILL: {
    icon: GraduationCap,
    reason: ({ skill }) => `Нет инженера с навыком «${skill}»`,
    help: 'Добавьте инженера с этим навыком',
  },
  NO_SKILL_LEVEL: {
    icon: GraduationCap,
    reason: null,
    help: 'Добавьте инженера с этим навыком',
  },
  NO_TRANSPORT: {
    icon: Car,
    reason: ({ transport }) =>
      transport
        ? `Нужен ${transportNeed(transport)}, а у инженеров с нужным навыком его нет`
        : 'Нужен другой транспорт, а у инженеров с нужным навыком его нет',
    help: 'Смените транспорт у одного из инженеров или добавьте инженера на автомобиле',
  },
  NO_DIRECT_FEASIBLE_SLOT: {
    icon: Clock,
    reason: ({ window }) =>
      `Работа не помещается в окно ${window} и в смену ни у одного подходящего инженера`,
    help: 'Продлите смену или добавьте инженера',
  },
  NO_CAPACITY: {
    icon: Users,
    reason: ({ window, names }) =>
      names.length
        ? `Все подходящие инженеры заняты в окне ${window}: ${namesText(names)}`
        : `Все подходящие инженеры заняты в окне ${window}`,
    help: 'Добавьте инженера или переназначьте вручную менее срочную заявку',
  },
  NO_EQUIPMENT: { icon: Package, reason: null, help: null },
  DISPATCHER_NOT_ASSIGNED: {
    icon: CircleAlert,
    reason: () => 'В реальном распределении бригада не назначена',
    help: null,
  },
};

export interface UnassignedExplain {
  icon: LucideIcon;
  reason: string;
  /** «Что поможет»; `null` — строку не выводим. */
  help: string | null;
}

/** Причина неназначения по коду: шаблон §7.2 с данными дня, иначе текст бэка. */
export function explainUnassigned(
  code: string,
  backendReason: string,
  ctx: ReasonContext,
): UnassignedExplain {
  const template = REASONS[code];
  const fallback = backendReason.trim().replace(/\.$/, '') || 'Заявка не назначена';
  return {
    icon: template?.icon ?? CircleAlert,
    reason: template?.reason ? template.reason(ctx) : fallback,
    help: template?.help ?? null,
  };
}
