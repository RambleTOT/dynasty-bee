/** Вкладка «Лента» (DS-03, FRONTEND_SPEC §6.5): события новые сверху, фильтр «Требуют решения». */
import { Inbox, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { FeedRow } from '@/adapters/feed';
import { Button, SegmentedControl, ToneChip, cx } from '@/ui';
import styles from './Panel.module.css';

type FeedFilter = 'all' | 'need';

export function FeedPanel({
  rows,
  onOpenProposal,
  onResend,
  canResend,
  resendingId = null,
}: {
  rows: FeedRow[];
  onOpenProposal: (planId: string) => void;
  /** «Пересчитать» устаревшее предложение; не собрать событие заново — «Открыть» его. */
  onResend: (planId: string) => void;
  canResend: (planId: string) => boolean;
  resendingId?: string | null;
}) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const need = rows.filter((r) => r.needsDecision).length;
  const visible = filter === 'need' ? rows.filter((r) => r.needsDecision) : rows;
  return (
    <>
      <div className={styles.titleRow}>
        <h3 className={styles.title}>Лента</h3>
        <SegmentedControl<FeedFilter>
          size="sm"
          value={filter}
          onChange={setFilter}
          label="Фильтр ленты"
          options={[
            { value: 'all', label: 'Все' },
            { value: 'need', label: 'Требуют решения', count: need || null },
          ]}
        />
      </div>
      {visible.length === 0 ? (
        <div className={styles.emptyBox}>
          <Inbox size={20} className={styles.emptyIcon} aria-hidden />
          <span>
            {filter === 'need'
              ? 'Решений не ждёт ни одно событие'
              : 'Событий пока нет. Здесь появятся нажатия инженеров и изменения плана'}
          </span>
        </div>
      ) : (
        <div className={styles.feed}>
          {visible.map((row) => {
            const Icon = row.icon;
            // устаревшее, но событие не собрать — открыть предложение, там «Отклонить»
            const action =
              row.action?.kind === 'resend' && !canResend(row.action.planId)
                ? { ...row.action, kind: 'open' as const, label: 'Открыть' }
                : row.action;
            return (
              <div key={row.id} className={styles.feedRow}>
                <span className={styles.feedTime}>{row.time}</span>
                <span className={cx(styles.feedIcon, styles[`tone_${row.tone}`])}>
                  <Icon size={16} aria-hidden />
                </span>
                <div className={styles.feedBody}>
                  <div className={styles.feedText}>{row.text}</div>
                  {(row.chip || action) && (
                    <div className={styles.feedActions}>
                      {row.chip && (
                        <ToneChip tone={row.chip.tone} icon={row.chip.icon} size="sm">
                          {row.chip.label}
                        </ToneChip>
                      )}
                      <span className={styles.spacer} />
                      {action?.kind === 'resend' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={RefreshCw}
                          loading={resendingId === action.planId}
                          onClick={() => onResend(action.planId)}
                        >
                          {action.label}
                        </Button>
                      )}
                      {action?.kind === 'open' && (
                        <Button variant="secondary" size="sm" onClick={() => onOpenProposal(action.planId)}>
                          {action.label}
                        </Button>
                      )}
                    </div>
                  )}
                  {row.note && <span className={styles.caption}>{row.note}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
