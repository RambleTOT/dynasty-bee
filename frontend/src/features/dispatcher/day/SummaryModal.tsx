/**
 * DS-10 «Итоги дня» (FRONTEND_SPEC §8.2): карточки по статусам заявок, крупные показатели с Δ к FIFO,
 * таблица по бригадам. Считаем по действующему плану (adapters/summary.ts); Δ — из модели «Сравнения».
 */
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleX,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type { DayChain } from '@/adapters/dayChain';
import type { DayModel } from '@/adapters/dayModel';
import { buildDaySummary, type SummaryCardKey, type SummaryRow } from '@/adapters/summary';
import { regionLabel } from '@/lib/dictionaries';
import { formatDayTitle, formatHoursMinutes, formatKm } from '@/lib/format';
import { EmptyState, Modal, Table, cx, type TableColumn } from '@/ui';
import { useCompareData } from './useCompareData';
import styles from './SummaryModal.module.css';

const CARD_ICON: Record<SummaryCardKey, LucideIcon> = {
  done: CircleCheck,
  cancelled: CircleX,
  rescheduled: CalendarClock,
  unassigned: CircleAlert,
};

const COLUMNS: readonly TableColumn<SummaryRow>[] = [
  { key: 'name', title: 'Бригада', render: (r) => <span title={r.label}>{r.short}</span> },
  { key: 'tasks', title: 'Заявок', align: 'right', render: (r) => r.tasks },
  { key: 'done', title: 'Выполн.', align: 'right', render: (r) => r.done },
  { key: 'window', title: 'В окне', align: 'right', render: (r) => r.inWindow },
  { key: 'km', title: 'Км', align: 'right', render: (r) => formatKm(r.km) },
  {
    key: 'travel',
    title: 'Дорога',
    align: 'right',
    render: (r) => formatHoursMinutes(r.travelMinutes),
  },
  {
    key: 'work',
    title: 'Работа',
    align: 'right',
    render: (r) => formatHoursMinutes(r.workMinutes),
  },
  { key: 'wait', title: 'Ожид.', align: 'right', render: (r) => formatHoursMinutes(r.waitMinutes) },
];

export function SummaryModal({
  model,
  onClose,
}: {
  model: DayModel;
  chain: DayChain;
  onClose: () => void;
}) {
  const { compare } = useCompareData(model);
  const summary = useMemo(() => buildDaySummary(model, compare), [model, compare]);
  const subtitle = [
    regionLabel(model.regionId),
    model.version > 0 ? `версия ${model.version}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      open
      width={720}
      onClose={onClose}
      title={`Итоги дня · ${formatDayTitle(model.date)}`}
      subtitle={subtitle}
      bodyClassName={styles.body}
    >
      {!model.plan ? (
        <EmptyState icon={ClipboardList} title="План ещё не построен">
          Итоги появятся после публикации плана
        </EmptyState>
      ) : (
        <>
          <div className={styles.cards}>
            {summary.cards.map((card) => {
              const Icon = CARD_ICON[card.key];
              return (
                <section key={card.key} className={styles.card} aria-label={card.label}>
                  <span className={cx(styles.cardLabel, styles[`tone_${card.key}`])}>
                    <Icon size={14} aria-hidden />
                    {card.label}
                  </span>
                  <span className={styles.cardValue}>{card.value}</span>
                  {card.note && <span className={styles.cardNote}>{card.note}</span>}
                </section>
              );
            })}
          </div>
          <div className={styles.metrics}>
            {summary.metrics.map((metric) => (
              <section
                key={metric.key}
                className={cx(styles.metric, metric.highlight && styles.metricAccent)}
                aria-label={metric.label}
              >
                <span className={styles.metricLabel}>{metric.label}</span>
                <span className={styles.metricValue}>{metric.value}</span>
                {metric.delta && <span className={styles.metricDelta}>{metric.delta}</span>}
              </section>
            ))}
          </div>
          {summary.rows.length > 0 && (
            <div className={styles.tableBox}>
              <Table dense columns={COLUMNS} rows={summary.rows} rowKey={(r) => r.engineerId} />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
