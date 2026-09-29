import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, Map as MapIcon, Send, Zap } from 'lucide-react';
import { useState } from 'react';
import { lookupOf, type AddressSuggestion } from '@/adapters/address';
import { applyOperatorEmergency } from '@/api/booking';
import { errorMessage, isApiError } from '@/api/errors';
import { suggestAddresses } from '@/api/geocoder';
import { HD_EMERGENCY, TRANSPORT_ICON } from '@/lib/dictionaries';
import { notify } from '@/lib/notify';
import { TRANSPORT_LABEL, TRANSPORTS, isTransport, type Transport } from '@/lib/statuses';
import { Button, Callout, Input, Select, Textarea } from '@/ui';
import { AddressInput } from '../../shared/AddressInput';
import { invalidateBooking, mutationErrorText } from '../bookingCache';
import { T } from '../operatorTexts';
import { emergencyInput, type EmergencyInput } from './emergency';
import type { RegionPicker } from './RegularForm';
import styles from './forms.module.css';

const TRANSPORT_OPTIONS = TRANSPORTS.map((transport) => ({
  value: transport,
  label: TRANSPORT_LABEL[transport],
}));

/**
 * Вкладка «Авария» O-01 (FRONTEND_SPEC §8.3.9) — только при `emergencyByRegion` (⏳ 9.1).
 * Дата и окно не нужны: аварию распределит диспетчер, он получит предложение.
 */
export function EmergencyForm({ regions }: { regions: RegionPicker }) {
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  // адрес из подсказки или с карты — с координатами
  const [picked, setPicked] = useState<AddressSuggestion | null>(null);
  const [locating, setLocating] = useState(false);
  const [transport, setTransport] = useState<Transport>('car');
  const [comment, setComment] = useState('');
  // 409 / 422 бэка — плашка над кнопкой («Рабочий день в регионе … ещё не начат»)
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (input: EmergencyInput) => applyOperatorEmergency(input),
    onSuccess: () => {
      notify(T.crash.ok, 'success');
      // форма очищается, регион остаётся
      setAddress('');
      setPicked(null);
      setTransport('car');
      setComment('');
      invalidateBooking(queryClient);
    },
    onError: (error) => {
      if (isApiError(error) && (error.status === 409 || error.status === 422)) {
        setProblem(errorMessage(error));
        return;
      }
      notify(mutationErrorText(error), 'error');
    },
  });

  const region = regions.region;
  const ready = Boolean(region) && address.trim() !== '';

  async function submit() {
    if (!region || !ready || send.isPending || locating) return;
    setProblem(null);
    const text = address.trim();
    let point = picked && picked.value === text ? { lat: picked.lat, lon: picked.lon } : null;
    if (!point) {
      // адрес без подсказки — первый вариант сервиса; сервис не ответил — адрес найдёт бэк
      setLocating(true);
      const lookup = lookupOf(await suggestAddresses(text).catch(() => null));
      setLocating(false);
      if (lookup.status === 'none') {
        setProblem(T.crash.addressNotFound);
        return;
      }
      if (lookup.status === 'found') point = { lat: lookup.suggestion.lat, lon: lookup.suggestion.lon };
    }
    send.mutate(emergencyInput({ region, typeHd: HD_EMERGENCY, address, transport, comment, point }));
  }

  // правка полей убирает устаревшую ошибку
  const edited =
    <V,>(set: (value: V) => void) =>
    (value: V) => {
      set(value);
      setProblem(null);
    };

  return (
    <>
      <div className={styles.grid}>
        <Select
          label={T.new.region}
          icon={MapIcon}
          options={regions.regions.map((item) => ({ value: item.id, label: item.name }))}
          value={region ?? ''}
          placeholder={T.new.choose}
          disabled={regions.regions.length === 0}
          onChange={edited(regions.setRegion)}
        />
        {/* авария — только HD «Авария»; «Информацию» записывают обычной заявкой (D-37) */}
        <Input label={T.new.typeHd} icon={Zap} value={HD_EMERGENCY} readOnly />
        <AddressInput
          fieldClassName={styles.wide}
          label={T.new.address}
          value={address}
          onChange={edited(setAddress)}
          onPick={setPicked}
          point={picked}
        />
        <Select
          fieldClassName={styles.wide}
          label={T.new.transport}
          icon={TRANSPORT_ICON[transport]}
          options={TRANSPORT_OPTIONS}
          value={transport}
          onChange={(value) => isTransport(value) && edited(setTransport)(value)}
        />
        <Textarea
          fieldClassName={styles.wide}
          label={T.crash.comment}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <Callout icon={Info}>{T.crash.note}</Callout>
      {problem && <Callout tone="danger">{problem}</Callout>}
      <div className={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          icon={Send}
          disabled={!ready}
          loading={send.isPending || locating}
          onClick={() => void submit()}
        >
          {T.crash.cta}
        </Button>
      </div>
    </>
  );
}
