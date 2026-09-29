/**
 * «Другой участок» (§14, `anyRegionEnabled`; ТЗ бэка — docs/spec/BACKEND_ANY_REGION.md): CSV
 * участка не из списка кейса. Пять шагов в модалке DS-02: участок и файлы → колонки → нормативы →
 * бригады → точки заявок. «Загрузить» создаёт или обновляет участок, сохраняет его ростер и грузит
 * файл в выданном формате оператора связи; дальше — тот же отчёт импорта, что у участков кейса.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Upload } from 'lucide-react';
import { useState } from 'react';
import type { ImportRegionReport } from '@/adapters/importReport';
import { getDay } from '@/api/days';
import { errorMessage } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { RegionItem } from '@/hooks/useRegions';
import { formatDateFull, formatDayMonth } from '@/lib/format';
import { Button, Callout, Modal } from '@/ui';
import { dayConflict } from '../dayConflict';
import { ColumnsStep } from './ColumnsStep';
import { FilesStep } from './FilesStep';
import { NormsStep } from './NormsStep';
import { PointsStep } from './PointsStep';
import { RosterStep } from './RosterStep';
import { uploadRegion, type RegionUpload } from './uploadRegion';
import { STEP_TITLE, STEPS, useRegionDraft, type WizardStep } from './useRegionDraft';
import styles from './RegionWizard.module.css';

export function RegionWizard({
  date,
  region,
  regions,
  onBack,
  onClose,
  onDone,
}: {
  date: string;
  /** Свой участок, в который грузим; `null` — новый участок. */
  region: RegionItem | null;
  /** Все участки — проверить, что название не занято. */
  regions: readonly RegionItem[];
  onBack: () => void;
  onClose: () => void;
  onDone: (run: { date: string; reports: ImportRegionReport[] }) => void;
}) {
  const queryClient = useQueryClient();
  const draft = useRegionDraft(region, regions);
  const [step, setStep] = useState<WizardStep>('files');
  const [showErrors, setShowErrors] = useState(false);
  // участок создан, а загрузка сорвалась дальше — повтор обновит его, а не создаст второй
  const [createdId, setCreatedId] = useState<string | null>(null);
  const regionId = region?.id ?? createdId;

  const day = useQuery({
    queryKey: queryKeys.days(date, regionId ?? ''),
    queryFn: ({ signal }) => getDay(date, regionId ?? '', signal),
    enabled: regionId !== null,
    staleTime: 0,
  });
  const conflict = dayConflict(day.data, regionId);
  const [confirming, setConfirming] = useState<RegionUpload | null>(null);

  const upload = useMutation({
    mutationFn: (payload: RegionUpload) => uploadRegion(payload, setCreatedId),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.regions });
      if (report.loaded) {
        void queryClient.invalidateQueries({ queryKey: ['calendar'] });
        void queryClient.invalidateQueries({ queryKey: ['days'] });
      }
      onDone({ date, reports: [report] });
    },
  });
  const busy = upload.isPending;
  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;
  // первый шаг показывает ошибки полей после попытки; на остальных они видны сразу
  const canGoOn = step === 'files' ? !busy : draft.valid[step] && !busy;

  function goNext() {
    if (!draft.valid[step] || (step === 'files' && conflict === 'blocked')) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    const next = STEPS[index + 1];
    if (next === 'norms') draft.prepareNorms();
    if (next === 'roster') draft.prepareRoster();
    setStep(next);
  }

  function submit() {
    const payload = draft.buildUpload(date, regionId);
    if (!payload) return;
    if (conflict === 'replace') setConfirming(payload);
    else upload.mutate(payload);
  }

  return (
    <Modal
      open
      width={720}
      title={region ? `Участок «${region.name}»` : 'Другой участок'}
      subtitle={`Шаг ${index + 1} из ${STEPS.length} · ${STEP_TITLE[step]} · план на ${formatDateFull(date)}`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button
            variant="ghost"
            icon={ArrowLeft}
            disabled={busy}
            onClick={() => (index === 0 ? onBack() : setStep(STEPS[index - 1]))}
          >
            Назад
          </Button>
          {last ? (
            <Button
              variant="primary"
              icon={Upload}
              loading={busy}
              disabled={!draft.valid.points || conflict === 'blocked'}
              onClick={submit}
            >
              Загрузить
            </Button>
          ) : (
            <Button variant="primary" iconRight={ArrowRight} disabled={!canGoOn} onClick={goNext}>
              Далее
            </Button>
          )}
        </>
      }
    >
      <div className={styles.stack}>
        {step === 'files' && (
          <FilesStep
            draft={draft}
            date={date}
            conflict={conflict}
            showErrors={showErrors}
            disabled={busy}
          />
        )}
        {step === 'columns' && <ColumnsStep draft={draft} disabled={busy} />}
        {step === 'norms' && <NormsStep draft={draft} disabled={busy} />}
        {step === 'roster' && <RosterStep draft={draft} disabled={busy} />}
        {step === 'points' && <PointsStep draft={draft} disabled={busy} />}
        {upload.isError && (
          <Callout tone="danger">
            {createdId && !region ? 'Участок создан, но загрузка не прошла: ' : ''}
            {errorMessage(upload.error)}
          </Callout>
        )}
      </div>
      {confirming && (
        <Modal
          open
          width={480}
          title="Заменить загруженный CSV?"
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                icon={Upload}
                onClick={() => {
                  upload.mutate(confirming);
                  setConfirming(null);
                }}
              >
                Заменить и загрузить
              </Button>
            </>
          }
        >
          <p className={styles.text}>
            На {formatDayMonth(date)} у участка уже загружен CSV. Новый файл заменит его: прежние
            заявки, план и события дня уйдут в архив и пропадут с экрана дня.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
