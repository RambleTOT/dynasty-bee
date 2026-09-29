import { ChevronDown, ChevronRight, CircleCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  routeGroups,
  type EngineerDayModel,
  type EngineerVisitModel,
} from '@/adapters/engineerDay';
import { requestNo } from '@/lib/engineerLabels';
import { Button, cx, StatusChip } from '@/ui';
import { visitPath } from './paths';
import { StatusPanel } from './StatusPanel';
import { AddressText, CardChips, EquipmentLine, RowFlags } from './VisitBits';
import styles from './VisitList.module.css';

/**
 * E-03 «Мои заявки» — «Список»: текущая заявка с панелью статуса (или «Все заявки закрыты»),
 * «Далее по маршруту», «Завершённые». `limited` — сообщил «Не могу работать»: кнопок нет,
 * заявку в работе можно выполнить (§9.1).
 */
export function MyVisits({
  day,
  limited,
  onInterrupt,
  onIncident,
  onShiftEnd,
  shiftEndPending,
}: {
  day: EngineerDayModel;
  limited: boolean;
  onInterrupt: () => void;
  onIncident: () => void;
  onShiftEnd: () => void;
  shiftEndPending: boolean;
}) {
  const { current, waiting, upcoming, completed } = routeGroups(day);
  return (
    <>
      {current ? (
        <ActiveVisitCard visit={current} total={day.total}>
          <StatusPanel
            visit={current}
            completeOnly={limited}
            onInterrupt={onInterrupt}
            onIncident={onIncident}
          />
        </ActiveVisitCard>
      ) : (
        <AllClosedCard onShiftEnd={limited ? undefined : onShiftEnd} pending={shiftEndPending} />
      )}
      <RouteList waiting={waiting} upcoming={upcoming} />
      <CompletedBlock visits={completed} />
    </>
  );
}

/** «приезд ≈ 15:32» у запланированной, «начало 14:10» — в пути и в работе (§9.2 E-03). */
function plannedTime(visit: EngineerVisitModel): string | null {
  if (visit.status === 'planned') return visit.arrival ? `приезд ≈ ${visit.arrival}` : null;
  return visit.start ? `начало ${visit.start}` : null;
}

/** Карточка текущей заявки (E-03, E-03.2, E-03.3): «ТЕКУЩАЯ · 4 ИЗ 9», панель статуса — `children`. */
export function ActiveVisitCard({
  visit,
  total,
  children,
}: {
  visit: EngineerVisitModel;
  total: number;
  children?: ReactNode;
}) {
  const time = plannedTime(visit);
  return (
    <section className={styles.card} aria-label="Текущая заявка">
      <div className={styles.eyebrow}>
        ТЕКУЩАЯ · {visit.sequence} ИЗ {total}
      </div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>
          <Link to={visitPath(visit.id)} className={styles.title}>
            {visit.title}
          </Link>
        </h2>
        <CardChips visit={visit} />
      </div>
      <div className={styles.address}>
        <AddressText address={visit.address} />
      </div>
      <div className={styles.meta}>
        <span>{requestNo(visit.id)}</span>
        {visit.windowFull && <span>окно {visit.windowFull}</span>}
        {time && <span>{time}</span>}
      </div>
      <EquipmentLine equipment={visit.equipment} />
      {children}
    </section>
  );
}

/** Все заявки закрыты (§9.2): вместо карточки текущей — «Завершить смену». */
export function AllClosedCard({
  onShiftEnd,
  pending = false,
}: {
  /** Нет — смену отсюда не завершить (сообщил «Не могу работать»). */
  onShiftEnd?: () => void;
  pending?: boolean;
}) {
  return (
    <section className={styles.card}>
      <CircleCheck size={28} className={styles.doneIcon} aria-hidden />
      <h2 className={styles.title}>Все заявки на сегодня закрыты</h2>
      {onShiftEnd && (
        <div className={styles.actions}>
          <Button variant="primary" size="lg" fullWidth loading={pending} onClick={onShiftEnd}>
            Завершить смену
          </Button>
        </div>
      )}
    </section>
  );
}

function RowTop({ time, address }: { time: string | null; address: string }) {
  return (
    <span className={styles.rowTop}>
      {time && <span className={styles.rowTime}>{time}</span>}
      <span className={styles.rowAddress}>
        <AddressText address={address} />
      </span>
    </span>
  );
}

/** Строка «Далее»: номер цветом маршрута, время приезда, адрес, «{заголовок} · окно {окно}», флаги. */
function VisitRow({ visit }: { visit: EngineerVisitModel }) {
  return (
    <Link to={visitPath(visit.id)} className={styles.row}>
      <span className={styles.seq}>{visit.sequence}</span>
      <span className={styles.rowMain}>
        <RowTop time={visit.arrival ?? visit.start} address={visit.addressShort} />
        <span className={styles.rowSub}>
          {visit.title}
          {visit.windowShort && ` · окно ${visit.windowShort}`}
        </span>
      </span>
      <RowFlags visit={visit} />
      <ChevronRight size={18} className={styles.chevron} aria-hidden />
    </Link>
  );
}

/** Ждёт решения диспетчера (Р-1): первой строкой «Далее», чип «Отменяется» / «Переносится». */
function WaitingRow({ visit }: { visit: EngineerVisitModel }) {
  return (
    <Link to={visitPath(visit.id)} className={styles.row}>
      <span className={styles.seq}>{visit.sequence}</span>
      <span className={styles.rowMain}>
        <RowTop time={visit.arrival ?? visit.start} address={visit.addressShort} />
        <span className={styles.rowSub}>Ждёт решения диспетчера</span>
      </span>
      <StatusChip status={visit.status} size="sm" />
      <ChevronRight size={18} className={styles.chevron} aria-hidden />
    </Link>
  );
}

/** Блок «Далее по маршруту»: сначала ждущие решения, затем запланированные по порядку. */
export function RouteList({
  waiting,
  upcoming,
}: {
  waiting: EngineerVisitModel[];
  upcoming: EngineerVisitModel[];
}) {
  if (waiting.length === 0 && upcoming.length === 0) return null;
  return (
    <section
      id="engineer-next"
      className={cx(styles.stack, styles.anchor)}
      aria-labelledby="engineer-next-title"
    >
      <h2 id="engineer-next-title" className={styles.sectionTitle}>
        Далее по маршруту
      </h2>
      <ul className={styles.list}>
        {waiting.map((visit) => (
          <li key={visit.id} className={styles.item}>
            <WaitingRow visit={visit} />
          </li>
        ))}
        {upcoming.map((visit) => (
          <li key={visit.id} className={styles.item}>
            <VisitRow visit={visit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Время закрытой заявки: по факту ⏳, иначе плановое начало. */
function closedTime(visit: EngineerVisitModel): string | null {
  if (visit.actualStart && visit.actualEnd) return `${visit.actualStart}–${visit.actualEnd}`;
  return visit.start ?? visit.arrival;
}

/** «Завершённые · N» — свёрнуто (§9.2): выполненные, отменённые, перенесённые. */
export function CompletedBlock({ visits }: { visits: EngineerVisitModel[] }) {
  const [open, setOpen] = useState(false);
  if (visits.length === 0) return null;
  return (
    <section className={cx(styles.completed, open && styles.open)}>
      <button
        type="button"
        className={styles.completedToggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <CircleCheck size={18} className={styles.doneIcon} aria-hidden />
        <span className={styles.completedLabel}>Завершённые · {visits.length}</span>
        <ChevronDown size={18} className={styles.toggleChevron} aria-hidden />
      </button>
      {open && (
        <ul className={styles.completedList}>
          {visits.map((visit) => {
            const time = closedTime(visit);
            return (
              <li key={visit.id} className={styles.item}>
                <Link to={visitPath(visit.id)} className={styles.row}>
                  {visit.status === 'done' ? (
                    <span className={styles.closedMark} role="img" aria-label="Выполнена">
                      <CircleCheck size={20} aria-hidden />
                    </span>
                  ) : (
                    <StatusChip status={visit.status} size="sm" />
                  )}
                  <span className={styles.rowMain}>
                    <span className={styles.rowAddress}>
                      <AddressText address={visit.addressShort} />
                    </span>
                  </span>
                  {time && <span className={styles.rowTime}>{time}</span>}
                  <ChevronRight size={18} className={styles.chevron} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
