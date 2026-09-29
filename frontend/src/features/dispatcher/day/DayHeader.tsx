/**
 * Шапка дня (DS-03): ‹ дата ›, бейджи CSV / Синтетика, статус плана, фильтры «Регион / Статус / Тип»,
 * кнопки по состоянию дня (§8.2). Фильтра по флагам нет (D-27).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DayModel } from '@/adapters/dayModel';
import { formatDayTitle } from '@/lib/format';
import { useRegions } from '@/hooks/useRegions';
import { REQUEST_STATUS_LABEL, REQUEST_STATUSES } from '@/lib/statuses';
import { Badge, FilterPill, IconButton, Tooltip } from '@/ui';
import styles from './DayPage.module.css';

const ALL = '__all__';

/** Демо-день бэка: структура выданного CSV, но адреса и координаты сгенерированы. */
const DEMO_HINT =
  'Демо-день стенда: заявки по структуре выданного CSV, адреса и координаты условные. Для оценки на реальных данных — дни из CSV';
const SYNTHETIC_HINT =
  'Координаты, длительности и состав бригад сгенерированы. Для оценки на реальных данных — дни из CSV';

export function DayHeader({
  date,
  regionId,
  model,
  meta,
  status,
  type,
  onDate,
  onRegion,
  onStatus,
  onType,
  actions,
}: {
  date: string;
  regionId: string;
  model: DayModel | null;
  meta: string | null;
  status: string | null;
  type: string | null;
  onDate: (delta: number) => void;
  onRegion: (regionId: string) => void;
  onStatus: (status: string | null) => void;
  onType: (type: string | null) => void;
  actions: ReactNode;
}) {
  const { regions } = useRegions();
  const presentStatuses = new Set(model?.requests.map((r) => r.status) ?? []);
  if (status) presentStatuses.add(status);
  const statusOptions = [
    { value: ALL, label: 'Все статусы' },
    ...REQUEST_STATUSES.filter((s) => presentStatuses.has(s)).map((s) => ({
      value: s as string,
      label: REQUEST_STATUS_LABEL[s],
    })),
  ];
  const typeOptions = [{ value: ALL, label: 'Все типы' }, ...(model?.typeOptions ?? [])];
  if (type && !typeOptions.some((o) => o.value === type)) typeOptions.push({ value: type, label: type });

  return (
    <div className={styles.header}>
      <div className={styles.dateNav}>
        <IconButton icon={ChevronLeft} label="Предыдущий день" variant="ghost" size="sm" onClick={() => onDate(-1)} />
        <h1 className={styles.dateTitle}>{formatDayTitle(date)}</h1>
        <IconButton icon={ChevronRight} label="Следующий день" variant="ghost" size="sm" onClick={() => onDate(1)} />
      </div>
      <div className={styles.dayMeta}>
        {model?.source === 'csv' && <Badge micro>CSV</Badge>}
        {model?.source === 'demo' && (
          <Tooltip label={DEMO_HINT} placement="bottom">
            <Badge micro>ДЕМО</Badge>
          </Tooltip>
        )}
        {model?.source === 'booking' && <Badge micro>ЗАПИСИ</Badge>}
        {model?.synthetic && (
          <Tooltip label={SYNTHETIC_HINT} placement="bottom">
            <Badge micro>СИНТЕТИКА</Badge>
          </Tooltip>
        )}
        {meta && <span className={styles.metaText}>{meta}</span>}
      </div>
      <div className={styles.filters}>
        <FilterPill
          label="Регион"
          value={regionId}
          allValue={ALL}
          options={regions.map((region) => ({ value: region.id, label: region.name }))}
          onChange={onRegion}
        />
        <FilterPill
          label="Статус"
          value={status ?? ALL}
          allValue={ALL}
          options={statusOptions}
          onChange={(value) => onStatus(value === ALL ? null : value)}
        />
        <FilterPill
          label="Тип заявки"
          value={type ?? ALL}
          allValue={ALL}
          options={typeOptions}
          onChange={(value) => onType(value === ALL ? null : value)}
        />
      </div>
      <div className={styles.actions}>{actions}</div>
    </div>
  );
}
