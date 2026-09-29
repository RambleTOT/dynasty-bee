import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FilePlus2, MapPinPlus, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  firstLoadedRegion,
  importReportFromError,
  importReportFromSummary,
  importTotals,
  type ImportRegionReport,
} from '@/adapters/importReport';
import { importBeeline } from '@/api/data';
import { getDay } from '@/api/days';
import { queryKeys } from '@/api/queryKeys';
import { useRegions, type RegionItem } from '@/hooks/useRegions';
import { formatFileSize, readCsvRowCount } from '@/lib/csv';
import { anyRegionEnabled } from '@/lib/regions';
import { countOf, formatDateFull, formatDayMonth, PL_BRIGADE, PL_ROW } from '@/lib/format';
import { REGION_LABEL, REGIONS, type RegionId } from '@/lib/statuses';
import { todayMsk } from '@/lib/time';
import { Button, Callout, Input, Modal } from '@/ui';
import { dayConflict, type DayConflict } from './dayConflict';
import { FileDrop } from './FileDrop';
import { initialImportDate, isImportDate } from './importDate';
import { RegionWizard } from './region/RegionWizard';
import { ReportCard } from './ReportCard';
import styles from './ImportModal.module.css';

type FileKind = 'requests' | 'control';

interface Picked {
  file: File;
  /** Строк заявок в файле; `null` — ещё считаем или не прочитали. */
  rows: number | null;
}

type Picks = Record<RegionId, Record<FileKind, Picked | null>>;

const NO_PICKS = Object.fromEntries(
  REGIONS.map((region) => [region, { requests: null, control: null }]),
) as Picks;

interface ImportJob {
  regionId: RegionId;
  requestsFile: File;
  controlFile: File | null;
}

interface ImportRun {
  date: string;
  reports: ImportRegionReport[];
}

const requestsMeta = ({ file, rows }: Picked) =>
  rows === null
    ? formatFileSize(file.size)
    : `${countOf(rows, PL_ROW)} · ${formatFileSize(file.size)}`;

const controlMeta = ({ rows }: Picked) =>
  rows === null
    ? 'Контрольное распределение'
    : `Контрольное распределение · ${countOf(rows, PL_ROW)}`;

/** Файл, брошенный мимо зоны, браузер открыл бы вместо приложения — пока модалка открыта, не даём. */
function useBlockStrayDrops() {
  useEffect(() => {
    const block = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);
}

/**
 * DS-02 «Загрузка CSV» — модалка 720 в два шага (FRONTEND_SPEC §8.2):
 * 1) дата плана и файлы по регионам → регионы грузятся параллельно на выбранную дату;
 * 2) отчёт импорта по каждому региону → «Открыть день».
 * Дата по умолчанию — сегодня, с пустого дня — дата этого дня (`initialDate`). В спеке даты нет
 * (D-26: всегда сегодня) — поле добавлено по просьбе заказчика, docs/API_NOTES.md п. 55.
 */
export function ImportModal({
  onClose,
  initialDate = null,
}: {
  onClose: () => void;
  initialDate?: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { regions: regionList, query: regions } = useRegions();
  const customRegions = regionList.filter((region) => !region.builtin);
  // «Другой участок» (§14): открыт мастер — для нового участка (`region: null`) или своего
  const [wizard, setWizard] = useState<{ region: RegionItem | null } | null>(null);
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const [run, setRun] = useState<ImportRun | null>(null);
  const [date, setDate] = useState(() => initialImportDate(initialDate));
  const dateOk = isImportDate(date);
  useBlockStrayDrops();

  // Один CSV на (регион, дату): если у региона на эту дату уже загружен CSV или есть записи
  // оператора, второй файл не грузим — сначала старые записи дня нужно удалить.
  const dayChecks = useQueries({
    queries: REGIONS.map((regionId) => ({
      queryKey: queryKeys.days(date, regionId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getDay(date, regionId, signal),
      enabled: dateOk && !run,
      staleTime: 0,
    })),
  });
  const conflicts = Object.fromEntries(
    REGIONS.map((regionId, index) => [regionId, dayConflict(dayChecks[index].data, regionId)]),
  ) as Record<RegionId, DayConflict | null>;
  // регионы, где новый файл заменит загруженный CSV: перед загрузкой — подтверждение
  const [confirming, setConfirming] = useState(false);
  const checking = dateOk && !run && dayChecks.some((check) => check.isPending);

  const upload = useMutation({
    mutationFn: async ({ date, jobs }: { date: string; jobs: ImportJob[] }): Promise<ImportRun> => {
      // регионы — по очереди: импорт тяжёлый (геокодинг, расчёт), параллельно бэк упирается в базу
      const settled: PromiseSettledResult<Awaited<ReturnType<typeof importBeeline>>>[] = [];
      for (const job of jobs) {
        const [result] = await Promise.allSettled([
          importBeeline({
            requestsFile: job.requestsFile,
            controlFile: job.controlFile,
            regionId: job.regionId,
            date,
          }),
        ]);
        settled.push(result);
      }
      const reports = settled.map((result, index) => {
        const job = jobs[index];
        return result.status === 'fulfilled'
          ? importReportFromSummary(job.regionId, result.value, job.controlFile !== null)
          : importReportFromError(job.regionId, result.reason);
      });
      return { date, reports };
    },
    // Колбэк мутации, а не вызова: календарь обновится, даже если модалку закрыли во время загрузки.
    onSuccess: ({ reports }) => {
      if (!reports.some((report) => report.loaded)) return;
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['days'] });
    },
  });

  function setPicked(region: RegionId, kind: FileKind, picked: Picked | null) {
    setPicks((prev) => ({ ...prev, [region]: { ...prev[region], [kind]: picked } }));
  }

  function pick(region: RegionId, kind: FileKind, file: File) {
    setPicked(region, kind, { file, rows: null });
    readCsvRowCount(file).then(
      (rows) =>
        setPicks((prev) =>
          prev[region][kind]?.file === file
            ? { ...prev, [region]: { ...prev[region], [kind]: { file, rows } } }
            : prev,
        ),
      () => undefined, // не прочитали — покажем только размер, число строк посчитает бэк
    );
  }

  const jobs: ImportJob[] = REGIONS.flatMap((regionId) => {
    const { requests, control } = picks[regionId];
    return requests && conflicts[regionId] !== 'blocked'
      ? [{ regionId, requestsFile: requests.file, controlFile: control?.file ?? null }]
      : [];
  });

  const busy = upload.isPending;
  const replacing = jobs.filter((job) => conflicts[job.regionId] === 'replace');

  if (wizard && !run) {
    return (
      <RegionWizard
        date={date}
        region={wizard.region}
        regions={regionList}
        onBack={() => setWizard(null)}
        onClose={onClose}
        onDone={(result) => {
          setWizard(null);
          setRun(result);
        }}
      />
    );
  }

  if (run) {
    const totals = importTotals(run.reports);
    const dayRegion = firstLoadedRegion(run.reports);
    return (
      <Modal
        open
        width={720}
        title="Отчёт импорта"
        subtitle={`Шаг 2 из 2 · план на ${formatDateFull(run.date)}`}
        onClose={onClose}
        footer={
          <>
            {totals && <span className={styles.totals}>{totals}</span>}
            <Button
              variant="ghost"
              icon={ArrowLeft}
              onClick={() => {
                upload.reset();
                setRun(null);
              }}
            >
              Назад
            </Button>
            <Button
              variant="primary"
              iconRight={ArrowRight}
              disabled={!dayRegion}
              onClick={() => navigate(`/dispatcher/day/${run.date}?region=${dayRegion}`)}
            >
              Открыть день
            </Button>
          </>
        }
      >
        <div className={styles.stack}>
          {run.reports.map((report) => (
            <ReportCard key={report.regionId} report={report} />
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      width={720}
      title="Загрузка CSV"
      subtitle="Шаг 1 из 2 · файлы. Можно загрузить от 1 до 3 регионов"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            icon={Upload}
            loading={busy}
            disabled={jobs.length === 0 || !dateOk || checking}
            onClick={() =>
              replacing.length > 0
                ? setConfirming(true)
                : upload.mutate({ date, jobs }, { onSuccess: setRun })
            }
          >
            Загрузить
          </Button>
        </>
      }
    >
      {confirming && (
        <Modal
          open
          width={480}
          title="Заменить загруженный CSV?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                icon={Upload}
                onClick={() => {
                  setConfirming(false);
                  upload.mutate({ date, jobs }, { onSuccess: setRun });
                }}
              >
                Заменить и загрузить
              </Button>
            </>
          }
        >
          <p className={styles.confirmText}>
            На {formatDayMonth(date)} уже загружен CSV:{' '}
            {replacing.map((job) => REGION_LABEL[job.regionId]).join(', ')}. Новый файл заменит его:
            прежние заявки, план и события дня уйдут в архив и пропадут с экрана дня.
          </p>
        </Modal>
      )}
      <div className={styles.stack}>
        <Input
          type="date"
          label="Дата плана"
          value={date}
          min={todayMsk()}
          required
          disabled={busy}
          fieldClassName={styles.dateField}
          hint={dateOk ? `Заявки из файлов попадут на ${formatDayMonth(date)}` : undefined}
          error={dateOk ? undefined : 'Выберите сегодняшний или будущий день'}
          onChange={(event) => setDate(event.target.value)}
        />
        {REGIONS.map((regionId) => {
          const { requests, control } = picks[regionId];
          const brigades = regions.data?.find(
            (region) => region.region_id === regionId,
          )?.engineer_count;
          const name = REGION_LABEL[regionId];
          const conflict = conflicts[regionId];
          const locked = busy || conflict === 'blocked';
          return (
            <section key={regionId} className={styles.region} aria-label={name}>
              <div className={styles.regionHead}>
                <h3 className={styles.regionName}>{name}</h3>
                {brigades !== undefined && (
                  <span className={styles.regionNote}>{countOf(brigades, PL_BRIGADE)}</span>
                )}
              </div>
              {conflict === 'replace' && (
                <Callout tone="warning">
                  На {formatDayMonth(date)} у региона уже загружен CSV. Новый файл заменит его:
                  прежние заявки, план и события дня уйдут в архив
                </Callout>
              )}
              {conflict === 'blocked' && (
                <Callout tone="warning">
                  На {formatDayMonth(date)} у региона уже есть записи оператора — CSV на этот день
                  бэк не примет. Выберите другую дату
                </Callout>
              )}
              <div className={styles.files}>
                <FileDrop
                  label="Файл заявок (.csv)"
                  hint="Перетащите файл или выберите"
                  icon={Upload}
                  inputLabel={`Файл заявок (.csv) · ${name}`}
                  picked={requests && { name: requests.file.name, meta: requestsMeta(requests) }}
                  disabled={locked}
                  onPick={(file) => pick(regionId, 'requests', file)}
                  onClear={() => setPicked(regionId, 'requests', null)}
                />
                <FileDrop
                  label="Контрольное распределение — по желанию"
                  hint="Нужен для сравнения с реальным диспетчером"
                  icon={FilePlus2}
                  inputLabel={`Контрольное распределение · ${name}`}
                  picked={control && { name: control.file.name, meta: controlMeta(control) }}
                  disabled={locked}
                  onPick={(file) => pick(regionId, 'control', file)}
                  onClear={() => setPicked(regionId, 'control', null)}
                />
              </div>
            </section>
          );
        })}
        {anyRegionEnabled() && (
          <>
            {customRegions.map((region) => (
              <CustomRegionCard
                key={region.id}
                region={region}
                disabled={busy || !dateOk}
                onOpen={() => setWizard({ region })}
              />
            ))}
            <section className={styles.region} aria-label="Другой участок">
              <div className={styles.regionHead}>
                <h3 className={styles.regionName}>Другой участок</h3>
              </div>
              <p className={styles.regionText}>
                Файл участка не из списка: свой офис, бригады и нормативы, любые колонки
              </p>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={MapPinPlus}
                  disabled={busy || !dateOk}
                  onClick={() => setWizard({ region: null })}
                >
                  Настроить загрузку
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Свой участок (§14) в шаге 1: файлы грузим через мастер — колонки, нормативы и бригады участка. */
function CustomRegionCard({
  region,
  disabled,
  onOpen,
}: {
  region: RegionItem;
  disabled: boolean;
  onOpen: () => void;
}) {
  const brigades = region.info?.engineer_count;
  return (
    <section className={styles.region} aria-label={region.name}>
      <div className={styles.regionHead}>
        <h3 className={styles.regionName}>{region.name}</h3>
        <span className={styles.regionNote}>
          {brigades ? `${countOf(brigades, PL_BRIGADE)} · ` : ''}свой участок
        </span>
      </div>
      {region.info?.office.address && (
        <p className={styles.regionText}>Офис: {region.info.office.address}</p>
      )}
      <div>
        <Button variant="secondary" size="sm" icon={Upload} disabled={disabled} onClick={onOpen}>
          Загрузить файл участка
        </Button>
      </div>
    </section>
  );
}
