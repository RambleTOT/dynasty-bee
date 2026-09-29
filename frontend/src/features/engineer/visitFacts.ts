import { isClosedStatus, isPendingStatus, type EngineerVisitModel } from '@/adapters/engineerDay';
import { durationLabel, requestNo } from '@/lib/engineerLabels';
import type { InfoItem } from '@/ui';

/** «СЛЕДУЮЩАЯ · 5 ИЗ 9» (§9.2 E-03.1); для текущей — «ТЕКУЩАЯ». [Д] ждущая и закрытая — свои подписи. */
export function positionLabel(
  visit: EngineerVisitModel,
  isCurrent: boolean,
  total: number,
): string {
  const kind = isCurrent
    ? 'ТЕКУЩАЯ'
    : isPendingStatus(visit.status)
      ? 'ЖДЁТ РЕШЕНИЯ'
      : isClosedStatus(visit.status)
        ? 'ЗАВЕРШЁННАЯ'
        : 'СЛЕДУЮЩАЯ';
  return `${kind} · ${visit.sequence} ИЗ ${total}`;
}

/** Серый блок: Номер · Тип · Район · Окно · Приезд · начало · Длительность · Гигабит · Технология. */
export function visitDetails(visit: EngineerVisitModel): (InfoItem | null)[] {
  const item = (label: string, value: string | null | false) => (value ? { label, value } : null);
  return [
    item('Номер', requestNo(visit.id)),
    item('Тип', visit.typeBk),
    item('Район', visit.district),
    item('Окно', visit.windowFull),
    item('Приезд · начало', [visit.arrival, visit.start].filter(Boolean).join(' · ')),
    item('Длительность', visit.durationMin != null && durationLabel(visit.durationMin)),
    item('Гигабит', visit.gigabit && 'да'),
    item('Технология', visit.technology),
  ];
}
