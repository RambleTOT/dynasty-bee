import { useNavigate } from 'react-router-dom';
import type { EngineerVisitModel } from '@/adapters/engineerDay';
import { requestNoShort, shiftEndWarning } from '@/lib/engineerLabels';
import { BottomSheet, Button } from '@/ui';
import { visitPath } from './paths';
import { useEngineerAction } from './useEngineerDay';
import styles from './Sheets.module.css';

/**
 * «Завершить смену» при оставшихся запланированных (§9.2): «Осталось N заявок. Они вернутся
 * диспетчеру» → `shift_end`. Заявка в пути или в работе (`blockedBy`) — завершить нельзя (бэк
 * ответит 409): объясняем, что сначала выполнить или прервать её.
 */
export function ShiftEndConfirm({
  count,
  blockedBy = null,
  onClose,
}: {
  count: number;
  blockedBy?: EngineerVisitModel | null;
  onClose: () => void;
}) {
  const action = useEngineerAction();
  const navigate = useNavigate();
  if (blockedBy) {
    return (
      <BottomSheet
        open
        onClose={onClose}
        title="Завершить смену пока нельзя"
        footer={
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                onClose();
                navigate(visitPath(blockedBy.id));
              }}
            >
              К текущей заявке
            </Button>
            <Button variant="tertiary" size="lg" fullWidth onClick={onClose}>
              Отмена
            </Button>
          </>
        }
      >
        <p className={styles.text}>
          Сначала закройте текущую заявку {requestNoShort(blockedBy.id)}: «Выполнить задачу» или
          «Прервать».
          {count > 0 ? ` ${shiftEndWarning(count)} после завершения смены.` : ''}
        </p>
      </BottomSheet>
    );
  }
  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Завершить смену"
      footer={
        <>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={action.isPending}
            onClick={() => action.mutate({ action: 'shift_end' }, { onSuccess: onClose })}
          >
            Завершить смену
          </Button>
          <Button
            variant="tertiary"
            size="lg"
            fullWidth
            disabled={action.isPending}
            onClick={onClose}
          >
            Отмена
          </Button>
        </>
      }
    >
      <p className={styles.text}>{shiftEndWarning(count)}</p>
    </BottomSheet>
  );
}
