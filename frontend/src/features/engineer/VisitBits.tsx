import { Package } from 'lucide-react';
import type { EngineerVisitModel } from '@/adapters/engineerDay';
import { ADDRESS_MISSING } from '@/lib/engineerLabels';
import { FlagChip, StatusChip, UrgentFlag } from '@/ui';
import { showChanged, useSeenVersion } from './seen';
import styles from './VisitList.module.css';

/** Статус и флаги в карточке; «Изменено» — пока карточку не открывали (`keepChanged` — открыта сейчас). */
export function CardChips({
  visit,
  keepChanged = false,
}: {
  visit: EngineerVisitModel;
  keepChanged?: boolean;
}) {
  useSeenVersion();
  const flags = visit.flags.filter(
    (flag) => flag !== 'changed' || keepChanged || showChanged(visit),
  );
  return (
    <>
      <StatusChip status={visit.status} />
      {flags.map((flag) => (
        <FlagChip key={flag} flag={flag} />
      ))}
    </>
  );
}

/** Флаги в строке: чипы «Изменено» и «Срочная», остальные — иконки с подписью (§9.2). */
export function RowFlags({ visit }: { visit: EngineerVisitModel }) {
  useSeenVersion();
  const changed = showChanged(visit);
  const urgent = visit.flags.includes('urgent');
  const others = visit.flags.filter((flag) => flag !== 'changed' && flag !== 'urgent');
  if (!changed && !urgent && others.length === 0) return null;
  return (
    <span className={styles.rowFlags}>
      {changed && <FlagChip flag="changed" size="sm" />}
      {urgent && <UrgentFlag size="sm" />}
      {others.map((flag) => (
        <FlagChip key={flag} flag={flag} size="sm" iconOnly />
      ))}
    </span>
  );
}

/** Адрес; нет адреса (синтетика) — «Адрес не указан» серым. */
export function AddressText({ address }: { address: string }) {
  return address ? <>{address}</> : <span className={styles.missing}>{ADDRESS_MISSING}</span>;
}

/** Оборудование ⏳ 8.8 — только из поля визита; нет поля — строки нет. */
export function EquipmentLine({ equipment }: { equipment: string | null }) {
  if (!equipment) return null;
  return (
    <div className={styles.equipment}>
      <Package size={14} aria-hidden />
      Оборудование: {equipment}
    </div>
  );
}
