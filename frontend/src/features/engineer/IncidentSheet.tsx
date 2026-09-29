import { CarFront, CircleSlash, MessageSquare, Send } from 'lucide-react';
import { useState } from 'react';
import type { EngineerModel, EngineerVisitModel } from '@/adapters/engineerDay';
import { isApiError } from '@/api/errors';
import { TRANSPORT_ICON } from '@/lib/dictionaries';
import { requestNo } from '@/lib/engineerLabels';
import {
  isTransport,
  REQUEST_STATUS_LABEL,
  TRANSPORT_LABEL,
  TRANSPORTS,
  type Transport,
} from '@/lib/statuses';
import { BottomSheet, Button, RadioCards, Select, Textarea, type RadioCardOption } from '@/ui';
import { incidentPayload, type IncidentReason } from './actionBodies';
import { useEngineerAction } from './useEngineerDay';
import styles from './Sheets.module.css';

const REASONS: RadioCardOption<IncidentReason>[] = [
  { value: 'transport_broken', label: 'Сломался транспорт', icon: CarFront },
  { value: 'cannot_continue', label: 'Не могу продолжить работу', icon: CircleSlash },
  { value: 'other', label: 'Другое', icon: MessageSquare },
];

/**
 * E-07 «Инцидент» ⏳ 8.4 → `incident`: сломался транспорт (новый транспорт), не могу продолжить,
 * другое (текст). Показываем, только если бэк принимает действие `incident` (флаг `engineerIncident`).
 */
export function IncidentSheet({
  visit,
  engineer,
  onClose,
}: {
  visit: EngineerVisitModel;
  engineer: Pick<EngineerModel, 'transport' | 'actualTransport'>;
  onClose: () => void;
}) {
  const now = engineer.actualTransport ?? engineer.transport;
  const choices = TRANSPORTS.filter((transport) => transport !== now);
  const [reason, setReason] = useState<IncidentReason>('transport_broken');
  const [newTransport, setNewTransport] = useState<Transport | null>(choices[0] ?? null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | undefined>();
  const action = useEngineerAction();

  function submit() {
    const result = incidentPayload(reason, { newTransport, comment });
    if ('field' in result) {
      if (result.field === 'comment') setCommentError(result.error);
      return;
    }
    setCommentError(undefined);
    action.mutate(
      { action: 'incident', request_id: visit.id, payload: result.payload },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (isApiError(error) && error.code === 'COMMENT_REQUIRED') {
            setCommentError(error.message || 'Опишите причину');
          }
        },
      },
    );
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Инцидент"
      subtitle={`${requestNo(visit.id)} · ${REQUEST_STATUS_LABEL[visit.status].toLowerCase()}`}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon={Send}
          loading={action.isPending}
          onClick={submit}
        >
          Сообщить диспетчеру
        </Button>
      }
    >
      <RadioCards
        name="incident-reason"
        dotSide="right"
        options={REASONS}
        value={reason}
        onChange={(value) => {
          setReason(value);
          setCommentError(undefined);
        }}
        className={styles.options}
      />
      {reason === 'transport_broken' && newTransport && (
        <Select
          label="Выберите новый транспорт"
          icon={TRANSPORT_ICON[newTransport]}
          options={choices.map((transport) => ({
            value: transport,
            label: TRANSPORT_LABEL[transport],
          }))}
          value={newTransport}
          onChange={(value) => isTransport(value) && setNewTransport(value)}
        />
      )}
      {reason === 'other' && (
        <Textarea
          label="Опишите причину"
          value={comment}
          required
          error={commentError}
          onChange={(event) => setComment(event.target.value)}
        />
      )}
    </BottomSheet>
  );
}
