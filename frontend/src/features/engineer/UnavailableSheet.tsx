import { Clock, Send } from 'lucide-react';
import { useState } from 'react';
import type { EngineerDayModel } from '@/adapters/engineerDay';
import { nowFor } from '@/lib/time';
import { BottomSheet, Button, Callout, RadioCards, Select, type RadioCardOption } from '@/ui';
import { quarterHours, unavailablePayload, type UnavailableReason } from './actionBodies';
import { useEngineerAction } from './useEngineerDay';
import styles from './Sheets.module.css';

const REASONS: RadioCardOption<UnavailableReason>[] = [
  { value: 'sick', label: 'Плохое самочувствие' },
  { value: 'family', label: 'Семейные обстоятельства' },
  { value: 'none', label: 'Без причины' },
];

/**
 * E-08 «Не могу работать» / «Не выйду сегодня» → `unavailable {from, reason?}`.
 * «С какого времени» — «Сейчас · {часы дня}» или шагом 15 мин до конца смены; до смены поля нет.
 */
export function UnavailableSheet({
  day,
  beforeShift,
  onClose,
}: {
  day: Pick<EngineerDayModel, 'clock' | 'engineer'>;
  /** «Не выйду сегодня» — до начала смены (⏳ 8.5). */
  beforeShift: boolean;
  onClose: () => void;
}) {
  const [from, setFrom] = useState('now');
  const [reason, setReason] = useState<UnavailableReason>('none');
  const action = useEngineerAction();
  const now = nowFor(day.clock);
  const times = [
    { value: 'now', label: `Сейчас · ${now}` },
    ...quarterHours(now, day.engineer.shiftEnd).map((time) => ({ value: time, label: time })),
  ];

  const submit = () =>
    action.mutate(
      { action: 'unavailable', payload: unavailablePayload(beforeShift ? 'now' : from, reason) },
      { onSuccess: onClose },
    );

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={beforeShift ? 'Не выйду сегодня' : 'Не могу работать'}
      subtitle="Причина — необязательно"
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon={Send}
          loading={action.isPending}
          onClick={submit}
        >
          Сообщить
        </Button>
      }
    >
      {!beforeShift && (
        <Select
          label="С какого времени"
          icon={Clock}
          options={times}
          value={from}
          onChange={setFrom}
          className={styles.timeBox}
        />
      )}
      <RadioCards
        name="unavailable-reason"
        dotSide="right"
        options={REASONS}
        value={reason}
        onChange={setReason}
        className={styles.options}
      />
      {/* [Д] До смены текущей заявки нет — подсказку про неё не показываем */}
      {!beforeShift && (
        <Callout tone="neutral">
          Текущую заявку доделайте. Остальные передадут другим инженерам после решения диспетчера
        </Callout>
      )}
    </BottomSheet>
  );
}
