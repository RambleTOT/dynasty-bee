import { Send } from 'lucide-react';
import { useState } from 'react';
import type { EngineerVisitModel } from '@/adapters/engineerDay';
import { isApiError } from '@/api/errors';
import { FEATURES } from '@/config';
import { ADDRESS_MISSING, requestNo } from '@/lib/engineerLabels';
import { notify } from '@/lib/notify';
import { addDays, todayMsk } from '@/lib/time';
import { BottomSheet, Button, Input, RadioCards, Textarea, type RadioCardOption } from '@/ui';
import { failPayload, type FailReason } from './actionBodies';
import { useEngineerAction } from './useEngineerDay';
import styles from './Sheets.module.css';

/** Причины (§9.2 E-06). */
const REASONS: RadioCardOption<FailReason>[] = [
  { value: 'client_refused', label: 'Клиент отказался' },
  { value: 'no_access', label: 'Нет доступа или техническая причина' },
  { value: 'client_reschedule', label: 'Клиент просит перенести' },
];

/** «Другое» — только если бэк принимает `other` + `comment` (⏳ 8.3). */
const OTHER: RadioCardOption<FailReason> = { value: 'other', label: 'Другое' };

/**
 * E-06 «Прервать выполнение» → `fail`. Заявка уходит в «Далее» с «Отменяется» / «Переносится»,
 * текущей становится следующая (D-30). `COMMENT_REQUIRED` — подсветка поля «Опишите причину».
 */
export function InterruptSheet({
  visit,
  dayDate,
  onClose,
  onSent,
}: {
  visit: EngineerVisitModel;
  /** День инженера: «Желаемая дата» — с завтра до +14 дней. */
  dayDate: string | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [reason, setReason] = useState<FailReason>('client_refused');
  const [desiredDate, setDesiredDate] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{ desiredDate?: string; comment?: string }>({});
  const action = useEngineerAction();

  const today = dayDate ?? todayMsk();
  const minDate = addDays(today, 1);
  const maxDate = addDays(today, 14);

  function submit() {
    const result = failPayload(reason, { desiredDate, comment, minDate, maxDate });
    if ('field' in result) {
      setErrors({ [result.field]: result.error });
      return;
    }
    setErrors({});
    action.mutate(
      { action: 'fail', request_id: visit.id, payload: result.payload },
      {
        onSuccess: () => {
          onClose();
          onSent?.();
        },
        onError: (error) => {
          if (!isApiError(error) || error.code !== 'COMMENT_REQUIRED') return;
          if (reason === 'other') setErrors({ comment: error.message || 'Опишите причину' });
          else notify(error.message, 'error');
        },
      },
    );
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Прервать выполнение"
      subtitle={`${requestNo(visit.id)} · ${visit.addressShort || ADDRESS_MISSING}`}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon={Send}
          loading={action.isPending}
          onClick={submit}
        >
          Отправить диспетчеру
        </Button>
      }
    >
      <RadioCards
        name="interrupt-reason"
        options={FEATURES.failOther ? [...REASONS, OTHER] : REASONS}
        value={reason}
        onChange={(value) => {
          setReason(value);
          setErrors({});
        }}
        className={styles.reasons}
      />
      {reason === 'client_reschedule' && (
        <Input
          type="date"
          label="Желаемая дата"
          min={minDate}
          max={maxDate}
          value={desiredDate}
          required
          error={errors.desiredDate}
          onChange={(event) => setDesiredDate(event.target.value)}
        />
      )}
      {reason === 'other' && (
        <Textarea
          label="Опишите причину"
          value={comment}
          required
          error={errors.comment}
          onChange={(event) => setComment(event.target.value)}
        />
      )}
    </BottomSheet>
  );
}
