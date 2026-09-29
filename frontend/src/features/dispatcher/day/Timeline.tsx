/**
 * Таймлайн дня (DS-03): ось — от min `shift_start` до max `shift_end` бригад по целым часам (§10.3),
 * дорога — штриховкой, ожидание — пунктиром, блок визита — заливка по тону статуса и кромка цветом бригады.
 */
import { CircleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { matchesFilters, type DayEngineer, type DayFilters, type DayModel, type DayRequest } from '@/adapters/dayModel';
import type { TimelineOverlay } from '@/adapters/timelineDraft';
import { SKILL_ICON, TRANSPORT_ICON } from '@/lib/dictionaries';
import { countOf, formatKm, PL_REQUEST } from '@/lib/format';
import {
  FLAG_ICON,
  FLAG_LABEL,
  FLAG_TONE,
  isSkill,
  isTransport,
  REQUEST_STATUS_LABEL,
  isRequestStatus,
} from '@/lib/statuses';
import { axisFraction, axisHours, fromMin, toMin, todayMsk, windowShort, type TimeAxis } from '@/lib/time';
import { cx } from '@/ui';
import styles from './Timeline.module.css';

interface TimelineProps {
  model: DayModel;
  filters: DayFilters;
  brigade: string | null;
  selectedRequest: string | null;
  onOpenRequest: (id: string) => void;
  onOpenUnassigned: (id: string) => void;
  /** Черновик (предложение, сравнение версий, переназначение): `model` — черновика. */
  draft?: TimelineOverlay | null;
}

const pct = (minutes: number, axis: TimeAxis) => `${(axisFraction(minutes, axis) * 100).toFixed(3)}%`;

function span(from: number, to: number, axis: TimeAxis): CSSProperties {
  const left = axisFraction(from, axis);
  const right = axisFraction(to, axis);
  return { left: `${(left * 100).toFixed(3)}%`, width: `${(Math.max(0, right - left) * 100).toFixed(3)}%` };
}

const STATUS_CLASS: Record<string, string | undefined> = {
  done: styles.sDone,
  in_progress: styles.sWork,
  en_route: styles.sWork,
  planned: styles.sPlan,
  cancel_pending: styles.sPending,
  reschedule_pending: styles.sPending,
  unassigned: styles.sDanger,
  cancelled: styles.sClosed,
  rescheduled: styles.sClosed,
};

function EngineerName({ engineer, hasPlan }: { engineer: DayEngineer; hasPlan: boolean }) {
  const TransportIcon = isTransport(engineer.transport) ? TRANSPORT_ICON[engineer.transport] : null;
  const meta = !engineer.available
    ? 'недоступен'
    : !hasPlan
      ? `смена ${windowShort(engineer.shiftStart, engineer.shiftEnd)}`
      : engineer.used
        ? `${countOf(engineer.taskCount, PL_REQUEST)} · ${formatKm(engineer.distanceKm)} км`
        : 'не задействован';
  const muted = !engineer.available || (hasPlan && !engineer.used);
  return (
    <div className={styles.name}>
      <span className={cx(styles.dot, styles[`c${engineer.color.index}`])} aria-hidden />
      <div className={styles.nameText}>
        <div className={cx(styles.nameLabel, muted && styles.muted)}>{engineer.label}</div>
        <div className={styles.nameMeta}>
          {TransportIcon && <TransportIcon size={14} aria-label={engineer.transportLabel} />}
          {engineer.skills.map((skill) => {
            if (!isSkill(skill)) return null;
            const Icon = SKILL_ICON[skill];
            return <Icon key={skill} size={14} aria-hidden />;
          })}
          <span className={styles.metaText}>{meta}</span>
        </div>
      </div>
    </div>
  );
}

function VisitBlock({
  request,
  engineer,
  axis,
  dim,
  selected,
  moved = false,
  onOpen,
}: {
  request: DayRequest;
  engineer: DayEngineer;
  axis: TimeAxis;
  dim: boolean;
  selected: boolean;
  /** Черновик: визит на новом месте. */
  moved?: boolean;
  onOpen: () => void;
}) {
  const visit = request.visit!;
  const start = toMin(visit.start);
  const end = toMin(visit.end);
  const arrival = toMin(visit.arrival);
  const roadFrom = arrival - (visit.travelMinutes || 0);
  const statusClass = request.emergency && request.status !== 'done' ? styles.sDanger : STATUS_CLASS[request.status];
  const late = request.flags.includes('late');
  const status = isRequestStatus(request.status) ? REQUEST_STATUS_LABEL[request.status] : request.status;
  return (
    <>
      {selected && (
        <div className={styles.window} style={span(toMin(request.windowStart), toMin(request.windowEnd), axis)}>
          <span className={styles.windowLabel}>ОКНО {request.windowShort}</span>
        </div>
      )}
      {visit.travelMinutes > 0 && roadFrom < arrival && (
        <div className={cx(styles.road, dim && styles.dim)} style={span(roadFrom, arrival, axis)} aria-hidden />
      )}
      {start > arrival && (
        <div className={cx(styles.wait, dim && styles.dim)} style={span(arrival, start, axis)} aria-hidden />
      )}
      <button
        type="button"
        className={cx(
          styles.block,
          statusClass,
          late && styles.sDanger,
          styles[`c${engineer.color.index}`],
          moved && styles.movedBlock,
          selected && styles.selectedBlock,
          dim && styles.dim,
        )}
        style={span(start, end, axis)}
        onClick={onOpen}
        title={`№${request.id} · ${request.typeFull} · окно ${request.windowShort}\n${engineer.label} · ${visit.start}–${visit.end} · ${status}`}
      >
        <span className={styles.blockId}>{request.shortId}</span>
        <span className={styles.blockSub}>
          {request.typeShort} · {request.windowShort}
        </span>
        {request.flags.length > 0 && (
          <span className={styles.flags}>
            {request.flags.map((flag) => {
              const Icon = FLAG_ICON[flag];
              return (
                <Icon
                  key={flag}
                  size={12}
                  strokeWidth={2.25}
                  className={styles[`f_${FLAG_TONE[flag]}`]}
                  aria-label={FLAG_LABEL[flag]}
                />
              );
            })}
          </span>
        )}
      </button>
    </>
  );
}

/** Неназначенные: блок на всё окно; пересекающиеся окна — на разных дорожках. */
function lanesOf(requests: DayRequest[]): DayRequest[][] {
  const sorted = [...requests].sort((a, b) => toMin(a.windowStart) - toMin(b.windowStart));
  const lanes: { end: number; items: DayRequest[] }[] = [];
  for (const request of sorted) {
    const start = toMin(request.windowStart);
    const lane = lanes.find((l) => l.end <= start);
    if (lane) {
      lane.items.push(request);
      lane.end = toMin(request.windowEnd);
    } else {
      lanes.push({ end: toMin(request.windowEnd), items: [request] });
    }
  }
  return lanes.map((l) => l.items);
}

export function Timeline({
  model,
  filters,
  brigade,
  selectedRequest,
  onOpenRequest,
  onOpenUnassigned,
  draft = null,
}: TimelineProps) {
  const axis = model.axis;
  if (!axis) {
    return <div className={styles.empty}>Нет смен бригад — ось времени не построить</div>;
  }
  const hasPlan = Boolean(model.plan);
  const hours = axisHours(axis);
  const nowMin = toMin(model.now);
  const showNow =
    (model.date === todayMsk() || Boolean(model.clock)) && nowMin >= axis.start && nowMin <= axis.end;

  const visitsByEngineer = new Map<string, DayRequest[]>();
  for (const request of model.requests) {
    if (!request.visit || !request.engineerId) continue;
    const list = visitsByEngineer.get(request.engineerId) ?? [];
    list.push(request);
    visitsByEngineer.set(request.engineerId, list);
  }
  const unassigned = hasPlan
    ? model.unassigned
        .map((u) => model.requestById.get(u.requestId))
        .filter((r): r is DayRequest => Boolean(r))
    : [];
  const lanes = lanesOf(unassigned);

  return (
    <div className={styles.timeline}>
      <div className={styles.head}>
        <div className={styles.headName}>БРИГАДА</div>
        <div className={styles.headAxis}>
          {hours.map((m) => (
            <span key={m} className={styles.hour} style={{ left: pct(m, axis) }}>
              {fromMin(m)}
            </span>
          ))}
          {showNow && (
            <span className={styles.nowLabel} style={{ left: pct(nowMin, axis) }}>
              {model.now}
            </span>
          )}
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.rows}>
          <div className={styles.grid} aria-hidden>
            {hours.map((m) => (
              <span key={m} className={styles.gridLine} style={{ left: pct(m, axis) }} />
            ))}
            {showNow && <span className={styles.nowLine} style={{ left: pct(nowMin, axis) }} />}
          </div>
          {model.engineers.map((engineer) => {
            const visits = visitsByEngineer.get(engineer.id) ?? [];
            const changed = draft ? draft.changed.has(engineer.id) : false;
            // в черновике приглушаем бригады без изменений, фильтры дня не применяем
            const rowDim = draft ? !changed : Boolean(brigade) && brigade !== engineer.id;
            return (
              <div
                key={engineer.id}
                className={cx(
                  styles.row,
                  !draft && brigade === engineer.id && styles.rowActive,
                  changed && styles.rowChanged,
                )}
              >
                <EngineerName engineer={engineer} hasPlan={hasPlan} />
                <div className={styles.track}>
                  {!hasPlan && (
                    <div
                      className={styles.shift}
                      style={span(toMin(engineer.shiftStart), toMin(engineer.shiftEnd), axis)}
                      aria-hidden
                    />
                  )}
                  {(draft?.ghost.get(engineer.id) ?? []).map((ghost) => (
                    <div
                      key={`ghost-${ghost.requestId}`}
                      className={styles.ghost}
                      style={span(toMin(ghost.start), toMin(ghost.end), axis)}
                      title={`Было: №${ghost.requestId} · ${ghost.start}–${ghost.end}`}
                    >
                      <span className={styles.blockId}>{ghost.label}</span>
                    </div>
                  ))}
                  {visits.map((request) => (
                    <VisitBlock
                      key={request.id}
                      request={request}
                      engineer={engineer}
                      axis={axis}
                      dim={rowDim || (!draft && !matchesFilters(request, filters))}
                      selected={request.id === selectedRequest}
                      moved={Boolean(draft?.moved.has(request.id))}
                      onOpen={() => onOpenRequest(request.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {hasPlan && unassigned.length > 0 && (
            <div className={cx(styles.row, styles.unRow)} style={{ minHeight: Math.max(56, lanes.length * 44 + 12) }}>
              <div className={styles.name}>
                <span className={cx(styles.dot, styles.dotDanger)} aria-hidden />
                <div className={styles.nameText}>
                  <div className={cx(styles.nameLabel, styles.danger)}>Неназначенные</div>
                  <div className={styles.nameMeta}>
                    <CircleAlert size={14} aria-hidden />
                    <span className={styles.metaText}>{countOf(unassigned.length, PL_REQUEST)}</span>
                  </div>
                </div>
              </div>
              <div className={styles.track}>
                {lanes.map((lane, laneIndex) =>
                  lane.map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      className={cx(
                        styles.unBlock,
                        !matchesFilters(request, filters) && styles.dim,
                        request.id === selectedRequest && styles.selectedBlock,
                      )}
                      style={{
                        ...span(toMin(request.windowStart), toMin(request.windowEnd), axis),
                        top: 8 + laneIndex * 44,
                      }}
                      onClick={() => onOpenUnassigned(request.id)}
                      title={`№${request.id} · ${request.typeFull} · окно ${request.windowShort}`}
                    >
                      <span className={styles.blockId}>{request.shortId}</span>
                      <span className={styles.blockSub}>
                        {request.typeShort} · {request.windowShort}
                      </span>
                    </button>
                  )),
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
