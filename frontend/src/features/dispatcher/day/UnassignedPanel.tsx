/** Вкладка «Неназначенные» (DS-03): причина, «Что поможет», ручное назначение и добавление инженера. */
import { ArrowRightLeft, CircleCheck, Lightbulb, UserPlus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { unassignedExplain } from '@/adapters/constraints';
import type { DayModel } from '@/adapters/dayModel';
import { typeTitle } from '@/lib/dictionaries';
import { Button, cx } from '@/ui';
import styles from './Panel.module.css';

export function UnassignedPanel({
  model,
  focus,
  canEdit,
  onReassign,
  onAddEngineer,
}: {
  model: DayModel;
  focus: string | null;
  /** План действует: доступно ручное назначение. */
  canEdit: boolean;
  onReassign: (requestId: string) => void;
  onAddEngineer: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const node = listRef.current?.querySelector(`[data-request="${CSS.escape(focus)}"]`);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focus]);

  if (!model.plan) {
    return (
      <>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>Неназначенные</h3>
        </div>
        <div className={styles.emptyBox}>План ещё не построен: неназначенные появятся после расчёта</div>
      </>
    );
  }

  return (
    <>
      <div className={styles.titleRow}>
        <h3 className={styles.title}>Неназначенные · {model.unassigned.length}</h3>
        <span className={styles.caption}>клиентское окно не двигаем</span>
      </div>
      {model.unassigned.length === 0 ? (
        <div className={styles.okBox}>
          <CircleCheck size={20} className={styles.okIcon} aria-hidden />
          Все заявки назначены
        </div>
      ) : (
        <div ref={listRef} className={styles.list}>
          {model.unassigned.map((item) => {
            const request = model.requestById.get(item.requestId);
            if (!request) return null;
            const explain = unassignedExplain(model, request, item.reasonCode, item.reason);
            const Icon = explain.icon;
            return (
              <article
                key={item.requestId}
                data-request={item.requestId}
                className={cx(styles.unCard, focus === item.requestId && styles.unCardFocus)}
              >
                <div className={styles.unHead}>
                  <span className={styles.unId}>№{request.id}</span>
                  <span className={styles.unKind}>
                    {typeTitle(request.raw.type_bk, request.raw.type_hd) || request.typeBk} · окно{' '}
                    {request.windowShort}
                  </span>
                </div>
                <div className={cx(styles.caption, !request.hasAddress && styles.tertiary)}>
                  {request.addressText}
                  {request.district ? ` · ${request.district}` : ''}
                </div>
                <div className={styles.unReason}>
                  <Icon size={14} aria-hidden />
                  <span>{explain.reason}</span>
                </div>
                {explain.help && (
                  <div className={styles.unHelp}>
                    <Lightbulb size={14} aria-hidden />
                    <span>
                      <b>Что поможет:</b> {explain.help}
                    </span>
                  </div>
                )}
                <div className={styles.unActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ArrowRightLeft}
                    disabled={!canEdit}
                    onClick={() => onReassign(request.id)}
                  >
                    Назначить вручную
                  </Button>
                  <Button variant="ghost" size="sm" icon={UserPlus} onClick={onAddEngineer}>
                    Добавить инженера
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
