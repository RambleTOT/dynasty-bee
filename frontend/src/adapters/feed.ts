/**
 * Лента дня (FRONTEND_SPEC §6.5): строка на событие, новые сверху. Текст — `payload.headline` ⏳,
 * иначе шаблон DESIGN_SPEC §7.3 по типу события со значениями из `payload`.
 */
import {
  AlarmClockOff,
  CalendarPlus,
  Check,
  CircleDot,
  History,
  CircleX,
  ClockAlert,
  GitCompareArrows,
  MapPin,
  Timer,
  TriangleAlert,
  UserCheck,
  UserPlus,
  UserX,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { EventItem } from '@/api/types';
import { engineerVerb as verb } from '@/lib/dictionaries';
import { transportOn } from '@/lib/explainTexts';
import { timeOfIso } from '@/lib/format';
import type { StatusTone } from '@/lib/statuses';
import type { DayChain } from './dayChain';
import type { DayModel } from './dayModel';
import { addedEngineerName, eventTimeOf } from './proposal';

export interface FeedRow {
  id: string;
  time: string;
  icon: LucideIcon;
  tone: StatusTone;
  text: string;
  chip: { label: string; tone: StatusTone; icon: LucideIcon } | null;
  note: string | null;
  /**
   * «Открыть» / «Решить» → DS-07 по предложению; «Пересчитать» (`resend`) — устаревшее
   * предложение: то же событие на действующей версии.
   */
  action: { label: string; planId: string; kind: 'open' | 'resend' } | null;
  needsDecision: boolean;
  event: EventItem;
}

const ICONS: Record<string, { icon: LucideIcon; tone: StatusTone }> = {
  urgent_order_added: { icon: Zap, tone: 'danger' },
  order_cancelled: { icon: CircleX, tone: 'warning' },
  engineer_unavailable: { icon: UserX, tone: 'warning' },
  engineer_available: { icon: UserCheck, tone: 'success' },
  engineer_added: { icon: UserPlus, tone: 'info' },
  order_added: { icon: CalendarPlus, tone: 'info' },
  plan_applied: { icon: Check, tone: 'neutral' },
  at_risk: { icon: ClockAlert, tone: 'warning' },
  engineer_delayed: { icon: ClockAlert, tone: 'warning' },
  late: { icon: AlarmClockOff, tone: 'danger' },
  finished_early: { icon: Timer, tone: 'success' },
  manual_reassign: { icon: GitCompareArrows, tone: 'changed' },
  incident: { icon: TriangleAlert, tone: 'warning' },
  transport_changed: { icon: CircleDot, tone: 'neutral' },
  en_route: { icon: MapPin, tone: 'info' },
  start: { icon: MapPin, tone: 'info' },
  complete: { icon: MapPin, tone: 'success' },
};

const FAIL_REASON: Record<string, string> = {
  client_refused: 'Клиент отказался',
  no_access: 'Нет доступа или техническая причина',
  client_reschedule: 'Клиент просит перенести',
  other: 'Другое',
};

const num = (id: unknown) => {
  const s = String(id ?? '');
  return s.length <= 6 ? s : `…${s.slice(-4)}`;
};

type Labels = Pick<DayModel, 'engineerById' | 'requestById'>;

function engineer(model: Labels, id: unknown): string {
  if (typeof id !== 'string' || !id) return 'Бригада';
  return model.engineerById.get(id)?.label ?? `Бригада ${id}`;
}

const ACTION_TEXT: Record<string, (engineer: string, order: string) => string> = {
  shift_start: (e) => `${e} ${verb(e, 'начал', 'начала')} смену`,
  en_route: (e, o) => `${e} в пути к №${o}`,
  start: (e, o) => `${e} ${verb(e, 'начал', 'начала')} работу по №${o}`,
  complete: (e, o) => `${e} ${verb(e, 'выполнил', 'выполнила')} №${o}`,
  fail: (e, o) => `${e}: проблема по №${o}`,
  delay: (e) => `${e} задерживается`,
  unavailable: (e) => `${e} ${verb(e, 'недоступен', 'недоступна')}`,
  shift_end: (e) => `${e} ${verb(e, 'завершил', 'завершила')} смену`,
};

const ACTION_TONE: Record<string, StatusTone> = {
  complete: 'success',
  fail: 'warning',
  unavailable: 'warning',
  delay: 'warning',
};

/**
 * Текст строки. Шаблоны DESIGN_SPEC §7.3 с именами бригад из модели дня; `headline` бэка — для типов,
 * которых шаблоны не знают (в нём id бригад, а не имена). `pending` — предложение ещё ждёт решения.
 */
function textOf(
  event: EventItem,
  model: Labels,
  versionOf: ReadonlyMap<string, number>,
  pending: boolean,
  failedBy: ReadonlyMap<string, string> = new Map(),
): string {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const headline = typeof p.headline === 'string' && p.headline.trim() ? p.headline : (event.headline ?? null);
  const scenario = (p.scenario ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const order = p.request_id ?? p.order_id ?? event.order_id;
  const time = eventTimeOf(event);

  switch (event.event_type) {
    case 'plan_applied': {
      const version = event.result_plan_id ? versionOf.get(event.result_plan_id) : undefined;
      return version
        ? `Версия ${version} применена. Инженеры получили обновление`
        : (headline ?? 'Версия применена. Инженеры получили обновление');
    }
    case 'engineer_action': {
      const action = String(p.action ?? '');
      const text = ACTION_TEXT[action];
      return text ? text(engineer(model, p.engineer_id ?? event.engineer_id), num(order)) : (headline ?? `Действие инженера: ${action}`);
    }
    case 'urgent_order_added': {
      const urgent = scenario.urgent;
      if (urgent?.engineer_id) {
        const arrival = (urgent.arrival ?? urgent.start) as string | undefined;
        return `Авария №${order} → ${engineer(model, urgent.engineer_id)}${arrival ? `, прибытие ${arrival}` : ''}`;
      }
      const address = model.requestById.get(String(order))?.addressText;
      return `Срочная заявка: Авария №${order}${address && address !== 'Адрес не указан' ? `, ${address}` : ''}`;
    }
    case 'order_cancelled': {
      const reason = typeof p.reason === 'string' ? FAIL_REASON[p.reason] : null;
      if (p.source === 'engineer') {
        // кто прервал — из нажатия «Прервать»: после пересчёта у заявки уже другая бригада
        const owner = failedBy.get(String(order)) ?? model.requestById.get(String(order))?.engineerId;
        const text = `${engineer(model, owner)}: «${reason ?? 'Прервано'}» по №${num(order)}`;
        return pending ? `${text} — требует решения` : text;
      }
      return `Отмена №${num(order)}${reason ? `: ${reason.toLowerCase()}` : ''}`;
    }
    case 'engineer_unavailable': {
      const left = Number(scenario.engineer_unavailable?.unassigned_count);
      const who = engineer(model, p.engineer_id);
      return `${who} ${verb(who, 'недоступен', 'недоступна')}${time ? ` с ${time}` : ''}${
        Number.isFinite(left) && left > 0 ? `: ${left} без исполнителя` : ''
      }`;
    }
    case 'engineer_available': {
      const who = engineer(model, p.engineer_id);
      return `${who} снова ${verb(who, 'доступен', 'доступна')}`;
    }
    case 'engineer_added':
      return `Новая бригада — ${addedEngineerName(model, p)}`;
    case 'transport_changed':
      return `${engineer(model, p.engineer_id)} ${transportOn(String(p.transport ?? ''))}`;
    case 'order_added': {
      const added = scenario.order_added;
      const request = model.requestById.get(String(order));
      return added?.engineer_id
        ? `Заявка №${num(order)} встроена к ${engineer(model, added.engineer_id)}${request ? `, окно ${request.windowShort}` : ''}`
        : `Заявка №${num(order)} добавлена`;
    }
    case 'manual_reassign':
      return `№${num(order)} → ${engineer(model, p.to_engineer_id)} вручную`;
    case 'engineer_delayed':
      return `${engineer(model, p.engineer_id)} отстаёт на ${Number(p.delay_min) || 0} мин`;
    case 'finished_early': {
      const who = engineer(model, p.engineer_id);
      return `${who} ${verb(who, 'освободился', 'освободилась')}${p.actual_end ? ` в ${p.actual_end}` : ''}`;
    }
    case 'extend_resource':
      return 'Добор ресурса под неназначенные';
    case 'incident': {
      // в headline бэка — id бригады: «Инцидент у инженера E06: {текст}»
      const detail = headline?.includes(': ') ? headline.slice(headline.indexOf(': ') + 2) : null;
      return `${engineer(model, p.engineer_id ?? event.engineer_id)}: инцидент${detail ? ` — ${detail}` : ''}`;
    }
    default:
      return headline ?? `Событие: ${event.event_type}`;
  }
}

export interface FeedInput {
  chain: Pick<DayChain, 'events' | 'planStatus' | 'headPlanId' | 'versions'> &
    Partial<Pick<DayChain, 'staleProposals' | 'consumed'>>;
  model: Labels;
}

export function buildFeed({ chain, model }: FeedInput): FeedRow[] {
  const versionOf = new Map(chain.versions.map((v) => [v.planId, v.version]));
  // когда версию приняли: событие `plan_applied` с `applied_at` (бэк 28.09)
  const appliedAt = new Map<string, string>();
  for (const e of chain.events) {
    if (e.event_type !== 'plan_applied' || !e.result_plan_id) continue;
    const at = e.applied_at ?? (e.payload?.applied_at as string | undefined);
    if (typeof at === 'string' && at) appliedAt.set(e.result_plan_id, at.slice(0, 5));
  }
  const stale = new Set((chain.staleProposals ?? []).map((p) => p.planId));
  // «Прервать» инженера: заявка → бригада, которая прервала
  const failedBy = new Map<string, string>();
  for (const e of [...chain.events].reverse()) {
    const p = e.payload ?? {};
    if (e.event_type !== 'engineer_action' || p.action !== 'fail') continue;
    const order = p.request_id ?? p.order_id ?? e.order_id;
    const who = p.engineer_id ?? e.engineer_id;
    if (order && typeof who === 'string') failedBy.set(String(order), who);
  }
  const consumed = chain.consumed ?? new Map<string, string>();
  return chain.events.map((event) => {
    const action = event.event_type === 'engineer_action' ? String(event.payload?.action ?? '') : '';
    const style = action
      ? { icon: MapPin, tone: ACTION_TONE[action] ?? ('info' as StatusTone) }
      : (ICONS[event.event_type] ?? { icon: CircleDot, tone: 'neutral' as StatusTone });
    const result = event.result_plan_id ?? null;
    const status = result ? chain.planStatus.get(result) : undefined;
    const editedInto = result ? consumed.get(result) : undefined;
    const outdated = Boolean(result && stale.has(result));
    const actionable = status === 'proposed' && event.plan_id === chain.headPlanId && !editedInto;
    // статус плана знаем — решаем сами (бэк считает «ждёт решения» и при неназначенных в принятом плане)
    const needsDecision = status ? actionable || outdated : event.needs_decision && Boolean(result);
    const engineerFail = event.event_type === 'order_cancelled' && event.payload?.source === 'engineer';

    let note: string | null = null;
    if (event.event_type === 'plan_applied' || action) {
      note = null;
    } else if (editedInto) {
      const version = versionOf.get(editedInto);
      note = `Принято с правкой вручную${version ? ` · версия ${version}` : ''}`;
    } else if (status === 'applied' || status === 'superseded' || status === 'completed') {
      const version = result ? versionOf.get(result) : undefined;
      const at = result ? appliedAt.get(result) : undefined;
      note = [at ? `Принято в ${at}` : 'Принято', version ? `версия ${version}` : null].filter(Boolean).join(' · ');
    } else if (status === 'rejected') {
      note = 'Отклонено';
    } else if (outdated) {
      note = 'План изменился после расчёта — пересчитайте на действующей версии';
    } else if (status === 'proposed' && !actionable) {
      note = 'Устарело: пересчитано на новой версии';
    }

    let chip: FeedRow['chip'] = null;
    if (outdated) chip = { label: 'Устарело', tone: 'warning', icon: History };
    else if (needsDecision) {
      chip = engineerFail
        ? { label: 'Отменяется', tone: 'warning', icon: ClockAlert }
        : { label: 'Ждёт решения', tone: 'warning', icon: ClockAlert };
    }

    let rowAction: FeedRow['action'] = null;
    if (outdated && result) rowAction = { label: 'Пересчитать', planId: result, kind: 'resend' };
    else if (needsDecision && result) rowAction = { label: engineerFail ? 'Решить' : 'Открыть', planId: result, kind: 'open' };

    return {
      id: event.event_id,
      time: eventTimeOf(event) ?? timeOfIso(event.created_at),
      icon: style.icon,
      tone: style.tone,
      text: textOf(event, model, versionOf, needsDecision, failedBy),
      chip,
      note,
      action: rowAction,
      needsDecision,
      event,
    };
  });
}
