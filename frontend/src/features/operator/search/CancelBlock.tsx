import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleX } from 'lucide-react';
import { useId, useState } from 'react';
import { normalizeOutcome, type BookingItem } from '@/adapters/booking';
import { cancelBooking } from '@/api/booking';
import { errorMessage } from '@/api/errors';
import type { BookingCancelBody, CancelReason } from '@/api/types';
import { FEATURES } from '@/config';
import { notify } from '@/lib/notify';
import { todayMsk } from '@/lib/time';
import { Button, RadioCards, Textarea } from '@/ui';
import { hasErrorCode, invalidateBooking, mutationErrorText, refreshSearch } from '../bookingCache';
import { T } from '../operatorTexts';
import { cancelBody, cancelDoneText, cancelReasons } from './cancel';
import styles from './CancelBlock.module.css';

const REASON_OPTIONS = cancelReasons(FEATURES.cancelComment).map((value) => ({
  value,
  label: T.cancel.reasons[value],
}));

/** «Отменить заявку?» под кнопками карточки (`cancel=1`, FRONTEND_SPEC §8.3.6). */
export function CancelBlock({ item, onClose }: { item: BookingItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const [reason, setReason] = useState<CancelReason>('client_refused');
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const body = cancelBody(reason, comment);

  const cancel = useMutation({
    mutationFn: (payload: BookingCancelBody) =>
      cancelBooking(item.id, payload, { regionId: item.regionId, date: item.date }),
    onSuccess: (result) => {
      const { message } = normalizeOutcome(result);
      notify(message ?? cancelDoneText(item.date, todayMsk()), 'info');
      invalidateBooking(queryClient);
      onClose();
    },
    onError: (error) => {
      if (hasErrorCode(error, 'COMMENT_REQUIRED')) {
        setCommentError(errorMessage(error));
        return;
      }
      notify(mutationErrorText(error), 'error');
      // отмена недопустима (⏳ 9.9): статус мог измениться — обновляем карточку
      if (hasErrorCode(error, 'ILLEGAL_TRANSITION')) {
        refreshSearch(queryClient);
        onClose();
      }
    },
  });

  return (
    <section className={styles.block} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        {T.cancel.title}
      </h3>
      <RadioCards
        name={`cancel-${item.id}`}
        options={REASON_OPTIONS}
        value={reason}
        onChange={(value) => {
          setReason(value);
          setCommentError(null);
        }}
        plain
      />
      {reason === 'other' && (
        <Textarea
          className={styles.comment}
          aria-label={T.cancel.comment}
          placeholder={T.cancel.comment}
          value={comment}
          error={commentError}
          onChange={(event) => {
            setComment(event.target.value);
            setCommentError(null);
          }}
          autoFocus
        />
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
          {T.cancel.back}
        </Button>
        <Button
          variant="danger"
          icon={CircleX}
          disabled={!body}
          loading={cancel.isPending}
          onClick={() => body && cancel.mutate(body)}
        >
          {T.cancel.submit}
        </Button>
      </div>
    </section>
  );
}
