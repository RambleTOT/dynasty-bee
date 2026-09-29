/** Вкладка «Сравнение» (DS-03, FRONTEND_SPEC §6.3): три колонки и пробег по инженерам. */
import { Maximize2 } from 'lucide-react';
import type { CompareModel } from '@/adapters/compare';
import { formatKm } from '@/lib/format';
import { Button, Skeleton, cx } from '@/ui';
import styles from './Panel.module.css';

export function CompareTable({ compare, loading }: { compare: CompareModel; loading: boolean }) {
  return (
    <div className={styles.cmpGrid}>
      <div />
      <div className={cx(styles.cmpHead, styles.cmpOursHead)}>Наш план</div>
      <div className={styles.cmpHead}>Базовый FIFO</div>
      <div className={styles.cmpHead}>Реальный диспетчер</div>
      {compare.rows.map((row, index) => {
        const last = index === compare.rows.length - 1;
        const highlight = row.key === 'km' && compare.hasPlan;
        return (
          <div key={row.key} className={styles.cmpRow}>
            <div className={styles.cmpLabel}>{row.label}</div>
            <div
              className={cx(
                styles.cmpOurs,
                highlight && styles.cmpAccent,
                last && styles.cmpOursLast,
              )}
            >
              <div className={styles.cmpValue}>{row.ours.value}</div>
              {row.ours.delta && <div className={styles.cmpDelta}>{row.ours.delta}</div>}
            </div>
            <div className={styles.cmpCell}>
              {loading && row.fifo.value === '—' ? <Skeleton width={40} height={20} /> : row.fifo.value}
            </div>
            <div className={styles.cmpCell}>
              {loading && row.dispatcher.value === '—' ? (
                <Skeleton width={40} height={20} />
              ) : (
                <>
                  <span className={row.dispatcher.value === 'нет данных' ? styles.cmpNoData : undefined}>
                    {row.dispatcher.value}
                  </span>
                  {row.dispatcher.note && <div className={styles.cmpNote}>{row.dispatcher.note}</div>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ComparePanel({
  compare,
  loading,
  onFullscreen,
}: {
  compare: CompareModel;
  loading: boolean;
  onFullscreen: () => void;
}) {
  const hasFifo = compare.engineers.some((e) => e.fifo != null);
  const max = compare.maxKm || 1;
  return (
    <>
      <div className={styles.titleRow}>
        <h3 className={styles.title}>Сравнение планов</h3>
      </div>
      <CompareTable compare={compare} loading={loading} />
      <p className={styles.note}>{compare.note}</p>
      {(compare.hasPlan || hasFifo) && (
        <>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>Пробег по инженерам, км</h3>
            <div className={styles.kmLegend}>
              <span>
                <i className={styles.kmOurs} aria-hidden />
                Наш
              </span>
              <span>
                <i className={styles.kmFifo} aria-hidden />
                FIFO
              </span>
            </div>
          </div>
          <div className={styles.kmList}>
            {compare.engineers.map((e) => (
              <div key={e.engineerId} className={styles.kmRow}>
                <span className={styles.kmName}>{e.short}</span>
                <span className={styles.kmBars} aria-hidden>
                  <i className={styles.kmOurs} style={{ width: `${((e.ours ?? 0) / max) * 100}%` }} />
                  <i className={styles.kmFifo} style={{ width: `${((e.fifo ?? 0) / max) * 100}%` }} />
                </span>
                <span className={styles.kmValue}>
                  <b>{e.ours != null ? formatKm(e.ours) : '—'}</b> / {e.fifo != null ? formatKm(e.fifo) : '—'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className={styles.panelFooter}>
        <Button variant="tertiary" size="sm" icon={Maximize2} onClick={onFullscreen}>
          На весь экран
        </Button>
      </div>
    </>
  );
}
