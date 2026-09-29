/**
 * Карточка заявки (DS-04): одна строка «Почему этот инженер», три ограничения и «Почему не другие»
 * (FRONTEND_SPEC §6.2). В ExplanationOut нет разбивки по ограничениям — строим из фактов плана.
 * Это отображение, а не повторная проверка.
 */
import type { ExplanationOut } from '@/api/types';
import { explainUnassigned, transportMove, transportNeed, transportOn } from '@/lib/explainTexts';
import { formatDelta, formatKm, plural, PL_ENGINEER } from '@/lib/format';
import { toMin } from '@/lib/time';
import type { DayEngineer, DayModel, DayRequest, DayVisit } from './dayModel';

export type ConstraintKey = 'skill' | 'time' | 'transport';

export interface ConstraintRow {
  key: ConstraintKey;
  label: 'Квалификация' | 'Время' | 'Ресурс';
  ok: boolean;
  text: string;
}

function carReason(request: DayRequest): string {
  const hd = request.raw.type_hd ?? '';
  return /кабел/i.test(hd) ? ` (${hd.trim().toLowerCase()})` : '';
}

export function constraintRows(
  visit: DayVisit,
  request: DayRequest,
  engineer: DayEngineer,
): ConstraintRow[] {
  const start = toMin(visit.actualStart ?? visit.start);
  const inWindow = start >= toMin(request.windowStart) && start <= toMin(request.windowEnd);
  const inShift = toMin(visit.end) <= toMin(engineer.shiftEnd);
  const required = request.requiredTransport;
  const hasSkill = engineer.skills.includes(request.skill);

  const time = [
    `Приезд ${visit.arrival}`,
    visit.waitingMinutes > 0 ? `ждёт окна ${visit.waitingMinutes} мин` : null,
    `начало ${visit.start} (окно ${request.windowShort})`,
    `окончание ${visit.end}`,
    `смена до ${engineer.shiftEnd}`,
    visit.slackMinutes != null ? `запас ${visit.slackMinutes} мин` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const rows: ConstraintRow[] = [
    {
      key: 'skill',
      label: 'Квалификация',
      ok: hasSkill,
      text: `Нужен навык «${request.skillLabel}», ${hasSkill ? 'у бригады есть' : 'у бригады нет'}`,
    },
    { key: 'time', label: 'Время', ok: inWindow && inShift, text: time },
    {
      key: 'transport',
      label: 'Ресурс',
      ok: !required || required === engineer.transport,
      text: required
        ? `Нужен ${transportNeed(required)}${carReason(request)}, бригада ${transportOn(engineer.transport)}`
        : `Особый транспорт не нужен, бригада ${transportOn(engineer.transport)}`,
    },
  ];
  for (const row of rows) {
    if (!row.ok) console.warn('[constraints] mismatch', request.id, row.key, row.text);
  }
  return rows;
}

/** «Бригада Соколов: есть навык «…», начнёт в 18:00 в окне 18–20, едет на автомобиле, 3,2 км от предыдущей заявки.» */
export function assignmentSummary(
  visit: DayVisit,
  request: DayRequest,
  engineer: DayEngineer,
): string {
  const from = visit.sequence <= 1 ? 'от старта' : 'от предыдущей заявки';
  return (
    `${engineer.label}: есть навык «${request.skillLabel}», начнёт в ${visit.start} в окне ${request.windowShort}, ` +
    `${transportMove(engineer.transport)}, ${formatKm(visit.legKm)} км ${from}.`
  );
}

export interface OtherEngineerRow {
  engineerId: string;
  label: string;
  color: DayEngineer['color'];
  reason: string;
}

interface LocalAlternative {
  engineer_id: string;
  delta_engineers: number;
  delta_distance_km: number;
}

function alternativesOf(explanation: ExplanationOut | null | undefined): LocalAlternative[] {
  const list = (explanation?.local_alternatives ?? []) as Record<string, unknown>[];
  return list
    .filter((a) => typeof a.engineer_id === 'string')
    .map((a) => ({
      engineer_id: a.engineer_id as string,
      delta_engineers: Number(a.delta_engineers) || 0,
      delta_distance_km: Number(a.delta_distance_km) || 0,
    }));
}

/**
 * «Почему не другие» — до 3 строк: сначала бригады, куда заявку можно переставить, но план хуже
 * (`local_alternatives`), затем бригады без навыка, с другим транспортом или вне окна.
 */
export function otherEngineers(
  model: Pick<DayModel, 'engineers'>,
  request: DayRequest,
  explanation: ExplanationOut | null | undefined,
  limit = 3,
): OtherEngineerRow[] {
  const current = request.engineerId;
  const rows: OtherEngineerRow[] = [];
  const used = new Set<string>(current ? [current] : []);
  const byId = new Map(model.engineers.map((e) => [e.id, e]));

  for (const alt of alternativesOf(explanation)) {
    const engineer = byId.get(alt.engineer_id);
    if (!engineer || used.has(engineer.id)) continue;
    used.add(engineer.id);
    const parts = [
      alt.delta_engineers > 0
        ? `ещё +${alt.delta_engineers} ${plural(alt.delta_engineers, PL_ENGINEER)} в работе`
        : null,
      Math.abs(alt.delta_distance_km) >= 0.05 ? `пробег ${formatDelta(alt.delta_distance_km, 'km')}` : null,
    ].filter(Boolean);
    rows.push({
      engineerId: engineer.id,
      label: engineer.label,
      color: engineer.color,
      reason: parts.join(', ') || 'план не лучше',
    });
  }

  const required = request.requiredTransport;
  for (const engineer of model.engineers) {
    if (used.has(engineer.id)) continue;
    let reason: string;
    if (!engineer.available) reason = 'не работает сегодня';
    else if (!engineer.skills.includes(request.skill)) reason = 'нет навыка';
    else if (required && engineer.transport !== required)
      reason = `${transportOn(engineer.transport)}, а нужен ${transportNeed(required)}`;
    else reason = `не успевает в окно ${request.windowShort}`;
    rows.push({ engineerId: engineer.id, label: engineer.label, color: engineer.color, reason });
  }
  return rows.slice(0, limit);
}

/** Карточка неназначенной заявки: причина по коду, «Что поможет», иконка. */
export function unassignedExplain(
  model: Pick<DayModel, 'engineers'>,
  request: DayRequest,
  reasonCode: string,
  backendReason: string,
) {
  const suitable = model.engineers.filter(
    (e) =>
      e.available &&
      e.skills.includes(request.skill) &&
      (!request.requiredTransport || e.transport === request.requiredTransport),
  );
  return explainUnassigned(reasonCode, backendReason, {
    skill: request.skillLabel,
    transport: request.requiredTransport,
    window: request.windowShort,
    names: suitable.map((e) => e.label),
  });
}
