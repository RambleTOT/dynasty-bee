/**
 * DS-05 «Сравнение на весь экран» (FRONTEND_SPEC §6.3, §8.2): слева три колонки крупно — инженеры, пробег,
 * неназначенные с Δ к FIFO; справа таблица по бригадам «н / F / д». Данные и расчёты — модель «Сравнения»
 * (adapters/compare.ts через useCompareData, кэш на версию плана), здесь только вёрстка.
 */
import type { CompareModel, CompareRow, EngineerKmRow } from '@/adapters/compare';
import type { DayChain } from '@/adapters/dayChain';
import type { DayModel } from '@/adapters/dayModel';
import { regionLabel } from '@/lib/dictionaries';
import { countOf, formatDayTitle, formatKm, PL_BRIGADE, PL_REQUEST } from '@/lib/format';
import { Modal, Skeleton, Table, cx, type TableColumn } from '@/ui';
import { useCompareData } from './useCompareData';
import styles from './CompareModal.module.css';

/** Крупно — три строки, как в макете (§8.2 DS-05). */
const BIG_ROWS: readonly CompareRow['key'][] = ['engineers', 'km', 'unassigned'];

const FOOTNOTE =
  'Базовый вариант FIFO — заявки по порядку строк файла, каждая в конец маршрута первого подходящего инженера, без оптимизации. Пробег реального диспетчера — оценка: порядок визитов в выгрузке не указан.';
const NO_PLAN_NOTE = 'Нажмите «Построить план», чтобы заполнить колонку «Наш план».';

const count = (n: number | null) => (n ? String(n) : '—');
const km = (n: number | null) => (n == null ? '—' : formatKm(n));

function engineerColumns(dispatcherMissing: boolean): TableColumn<EngineerKmRow>[] {
  return [
    {
      key: 'name',
      title: 'Бригада',
      render: (e) => <span title={e.label}>{e.short}</span>,
    },
    {
      key: 'tasks',
      title: 'Заявок н / F / д',
      align: 'right',
      render: (e) =>
        `${count(e.tasksOurs)} / ${count(e.tasksFifo)} / ${dispatcherMissing ? '—' : count(e.tasksDispatcher)}`,
    },
    { key: 'ours', title: 'Км наш', align: 'right', render: (e) => km(e.ours) },
    { key: 'fifo', title: 'FIFO', align: 'right', render: (e) => km(e.fifo) },
    {
      key: 'dispatcher',
      title: 'Дисп.*',
      align: 'right',
      render: (e) => km(dispatcherMissing ? null : e.dispatcher),
    },
  ];
}

function BigColumns({ compare, loading }: { compare: CompareModel; loading: boolean }) {
  const rows = BIG_ROWS.map((key) => compare.rows.find((row) => row.key === key)).filter(
    (row): row is CompareRow => Boolean(row),
  );
  const pending = (value: string) => loading && value === '—';
  return (
    <div className={styles.big}>
      <div />
      <div className={cx(styles.head, styles.oursHead)}>Наш план</div>
      <div className={styles.head}>Базовый FIFO</div>
      <div className={styles.head}>Реальный диспетчер</div>
      {rows.map((row, index) => {
        const accent = row.key === 'km' && compare.hasPlan;
        const last = index === rows.length - 1;
        const noData = row.dispatcher.value === 'нет данных';
        return (
          <div key={row.key} className={styles.row}>
            <div className={styles.label}>{row.label}</div>
            <div className={cx(styles.ours, accent && styles.oursAccent, last && styles.oursLast)}>
              <div className={styles.oursValue}>{row.ours.value}</div>
              {row.ours.delta && <div className={styles.delta}>{row.ours.delta}</div>}
            </div>
            <div className={styles.cell}>
              {pending(row.fifo.value) ? (
                <Skeleton width={72} height={32} />
              ) : (
                <div className={styles.value}>{row.fifo.value}</div>
              )}
            </div>
            <div className={styles.cell}>
              {pending(row.dispatcher.value) ? (
                <Skeleton width={72} height={32} />
              ) : (
                <>
                  <div className={cx(styles.value, noData && styles.noData)}>
                    {row.dispatcher.value}
                  </div>
                  {row.dispatcher.note && <div className={styles.note}>{row.dispatcher.note}</div>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CompareModal({
  model,
  onClose,
}: {
  model: DayModel;
  chain: DayChain;
  onClose: () => void;
}) {
  const { compare, loading } = useCompareData(model);
  const requests = model.requests.filter(
    (r) => r.status !== 'cancelled' && r.status !== 'rescheduled',
  ).length;
  const subtitle = [
    model.version > 0 ? `Версия ${model.version}` : null,
    countOf(requests, PL_REQUEST),
    countOf(model.engineers.length, PL_BRIGADE),
  ]
    .filter(Boolean)
    .join(' · ');
  const day = formatDayTitle(model.date).replace(',', '');

  return (
    <Modal
      open
      width={1200}
      onClose={onClose}
      title={`Сравнение планов · ${regionLabel(model.regionId)}, ${day}`}
      subtitle={subtitle}
      bodyClassName={styles.body}
    >
      {compare && (
        <div className={styles.layout}>
          <BigColumns compare={compare} loading={loading} />
          <div className={styles.tableBox}>
            <Table
              dense
              columns={engineerColumns(Boolean(compare.dispatcherMissing))}
              rows={compare.engineers}
              rowKey={(e) => e.engineerId}
            />
          </div>
        </div>
      )}
      <div className={styles.footnote}>
        {compare && !compare.hasPlan && <p>{NO_PLAN_NOTE}</p>}
        <p>{FOOTNOTE}</p>
      </div>
    </Modal>
  );
}
