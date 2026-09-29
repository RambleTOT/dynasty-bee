/**
 * Вкладка «Версии» (DS-03): применённые версии дня, новые сверху. Номер — по порядку, заголовок —
 * из события, породившего версию (⏳ бэк §4 — `version` и `headline` в `GET /planning`).
 */
import { CircleCheck, GitCompareArrows } from 'lucide-react';
import type { DayChain } from '@/adapters/dayChain';
import type { DayModel } from '@/adapters/dayModel';
import type { FeedRow } from '@/adapters/feed';
import { countOf, formatKm, PL_BRIGADE, PL_REQUEST, timeOfIso } from '@/lib/format';
import { regionLabel } from '@/lib/dictionaries';
import { Button, ToneChip, cx } from '@/ui';
import styles from './Panel.module.css';

export function VersionsPanel({
  chain,
  model,
  feed,
  onCompare,
}: {
  chain: DayChain;
  model: DayModel;
  feed: FeedRow[];
  onCompare: (planId: string) => void;
}) {
  const textByEvent = new Map(feed.map((row) => [row.id, row.text]));
  return (
    <>
      <div className={styles.titleRow}>
        <h3 className={styles.title}>Версии плана</h3>
        <span className={styles.caption}>новые сверху</span>
      </div>
      {chain.versions.length === 0 ? (
        <div className={styles.emptyBox}>
          {model.planState === 'draft'
            ? 'План ещё не опубликован: версии появятся после «Начать рабочий день»'
            : 'План ещё не построен'}
        </div>
      ) : (
        <div className={styles.list}>
          {chain.versions.map((version, index) => {
            const current = index === 0;
            const text = version.event
              ? (textByEvent.get(version.event.event_id) ?? version.event.event_type)
              : `План построен${model.source === 'csv' ? ' по CSV' : ''} · ${regionLabel(model.regionId)}`;
            const meta = [
              version.engineersUsed != null ? countOf(version.engineersUsed, PL_BRIGADE) : null,
              version.plannedCount != null ? countOf(version.plannedCount, PL_REQUEST) : null,
              version.distanceKm != null ? `${formatKm(version.distanceKm)} км` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <article key={version.planId} className={cx(styles.version, current && styles.versionCurrent)}>
                <div className={styles.versionHead}>
                  <span className={styles.versionTitle}>
                    Версия {version.version}
                    {version.createdAt ? ` · ${timeOfIso(version.createdAt)}` : ''}
                  </span>
                  {current && (
                    <ToneChip tone="neutral" icon={CircleCheck} size="sm">
                      Текущая
                    </ToneChip>
                  )}
                </div>
                <div className={styles.caption}>{text}</div>
                {meta && <div className={styles.caption}>{meta}</div>}
                {!current && (
                  <div className={styles.versionAction}>
                    <Button variant="ghost" size="sm" icon={GitCompareArrows} onClick={() => onCompare(version.planId)}>
                      Сравнить с текущей
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
