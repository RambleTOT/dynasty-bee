/**
 * DS-08 «Ручное переназначение» (FRONTEND_SPEC §6.7, §8.2 пп. 7, 23): кандидаты с метками по `check`,
 * позиция в маршруте, три ограничения, чипы-последствия; «Применить» или «Применить с нарушением»
 * (после подтверждения, `force: true`) → `/reassign` → сразу `/apply` (useDayActions).
 * «Показать на таймлайне» — черновик по ответу проверки; окно прячется, пока смотрят черновик.
 */
import { Check, CircleCheck, CircleX, GanttChart, TriangleAlert, UserX } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/api/errors';
import type { DayModel } from '@/adapters/dayModel';
import { reassignDraft } from '@/adapters/timelineDraft';
import { FEATURES } from '@/config';
import {
  candidateBadge,
  candidateInfo,
  consequenceChips,
  engineersDelta,
  freeAt,
  idleToday,
  inferPosition,
  minPosition,
  positionOptions,
  routeStops,
  type CheckSummary,
} from '@/adapters/reassign';
import { todayMsk, toMin } from '@/lib/time';
import {
  Button,
  Callout,
  EmptyState,
  ErrorState,
  Modal,
  Select,
  Skeleton,
  Spinner,
  ToneChip,
  cx,
} from '@/ui';
import type { DayActions } from './useDayActions';
import type { DraftRequest } from './useDraftTimeline';
import {
  useReassignBase,
  useReassignCandidates,
  useSelectedCheck,
  type CheckState,
} from './useReassign';
import styles from './ReassignModal.module.css';

function CheckResult({ state }: { state: CheckState | null }) {
  if (!state) return null;
  if (state.failed) {
    return (
      <Callout
        tone="danger"
        action={
          <Button variant="ghost" size="sm" onClick={state.refetch}>
            Повторить
          </Button>
        }
      >
        {errorMessage(state.error)}
      </Callout>
    );
  }
  if (!state.summary) return <Skeleton height={48} radius="var(--radius-md)" />;
  const { summary } = state;
  if (summary.feasible) {
    return (
      <div className={cx(styles.result, styles.resultOk)} role="status">
        <CircleCheck size={18} aria-hidden />
        Все три ограничения соблюдены
      </div>
    );
  }
  const rows = summary.violations.length
    ? summary.violations.map((v) => `${v.label}: ${v.text}`)
    : ['Ограничения не соблюдены'];
  return (
    <div className={cx(styles.result, styles.resultBad)} role="alert">
      {rows.map((text) => (
        <div key={text} className={styles.resultRow}>
          <CircleX size={18} aria-hidden />
          {text}
        </div>
      ))}
    </div>
  );
}

export function ReassignModal({
  requestId,
  basePlanId,
  model,
  actions,
  hidden = false,
  onPreview,
  onClose,
}: {
  requestId: string;
  /** План, от которого переназначаем; `null` — действующий. */
  basePlanId: string | null;
  model: DayModel;
  actions: DayActions;
  /** Смотрят черновик на таймлайне: окно прячем, выбор бригады и позиции сохраняем. */
  hidden?: boolean;
  onPreview?: (draft: DraftRequest) => void;
  onClose: () => void;
}) {
  // «свободен» / «занят до» и «раньше текущего времени» — только если у дня идут часы (или он сегодня)
  const nowMin = model.clock || model.date === todayMsk() ? toMin(model.now) : null;
  // «сейчас» дня для бэка, когда он научится его учитывать (BACKEND_REQUESTS п. 47)
  const time = FEATURES.reassignTime && nowMin != null ? model.now : null;
  const { base, planId, loading, failed, retry } = useReassignBase(model, basePlanId);
  const { request, candidates, checks } = useReassignCandidates(base, planId, requestId, time);
  const [picked, setPicked] = useState<string | null>(null);
  const [positions, setPositions] = useState<Readonly<Record<string, number>>>({});
  const [confirming, setConfirming] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // по умолчанию — первая подходящая из проверенных, пока проверки идут — ближайшая
  const autoId =
    candidates.find((c) => c.checkNow && checks.get(c.engineer.id)?.summary?.feasible)?.engineer
      .id ??
    candidates.find((c) => !c.filter)?.engineer.id ??
    null;
  const selectedId = picked ?? autoId;
  const position = selectedId ? (positions[selectedId] ?? null) : null;
  const selectedCheck = useSelectedCheck(
    planId,
    requestId,
    request,
    selectedId ? { engineerId: selectedId, position } : null,
    time,
  );
  const checkOf = (engineerId: string) =>
    engineerId === selectedId ? selectedCheck : checks.get(engineerId);

  const stopsOf = (engineerId: string) => (base ? routeStops(base, engineerId, requestId) : []);
  const upcoming = (at: string | null) => (at && (nowMin == null || toMin(at) > nowMin) ? at : null);
  const positionOf = (engineerId: string, summary: CheckSummary | null) =>
    positions[engineerId] ?? inferPosition(stopsOf(engineerId), summary?.newStart ?? null);

  const pick = (engineerId: string) => {
    setPicked(engineerId);
    setConfirming(false);
    setApplyError(null);
  };

  const apply = (force: boolean) => {
    if (!planId || !selectedId) return;
    setApplyError(null);
    // Позицию передаём всегда: без неё бэк вставляет заявку в начало маршрута, перед выполненными
    // визитами (docs/BACKEND_REQUESTS.md, п. 24). Не выбрана — та, что нашла проверка, но не
    // раньше последней выполненной / начатой точки.
    const stops = stopsOf(selectedId);
    const explicit =
      position ?? positionOf(selectedId, selectedCheck?.summary ?? null) ?? minPosition(stops);
    actions.reassign.mutate(
      {
        planId,
        body: {
          order_id: requestId,
          to_engineer_id: selectedId,
          position: explicit,
          force,
          ...(time ? { time } : {}),
        },
        nextVersion: model.version + 1,
      },
      {
        onSuccess: () => onClose(),
        onError: (error) => {
          setConfirming(false);
          setApplyError(errorMessage(error));
        },
      },
    );
  };

  const title = `Заявка №${requestId} → инженер`;
  const subtitle = request
    ? [
        request.typeBk,
        `окно ${request.windowShort}`,
        request.hasAddress ? request.addressText : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  let body;
  if (!planId) {
    body = <EmptyState icon={UserX} title="План ещё не построен" />;
  } else if (failed) {
    body = <ErrorState message="Не удалось загрузить план" onRetry={retry} />;
  } else if (loading || !base) {
    body = (
      <div className={styles.list}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={48} radius="var(--radius-md)" />
        ))}
      </div>
    );
  } else if (!request) {
    body = <EmptyState icon={UserX} title={`Заявки №${requestId} нет в плане`} />;
  } else if (candidates.length === 0) {
    body = <EmptyState icon={UserX} title="Других бригад на смене нет" />;
  } else {
    const summary = selectedCheck?.summary ?? null;
    const stops = selectedId ? stopsOf(selectedId) : [];
    const shownPosition = selectedId ? positionOf(selectedId, summary) : null;
    const chips =
      summary && selectedId
        ? consequenceChips(
            summary,
            engineersDelta(base, request, selectedId),
            (id) => base.requestById.get(id)?.number ?? `№${id}`,
          )
        : [];

    body = (
      <>
        <div className={styles.list} role="group" aria-label="Бригады">
          {candidates.map((candidate) => {
            const id = candidate.engineer.id;
            const state = checkOf(id) ?? null;
            const selected = id === selectedId;
            const candidateSummary = state?.summary ?? null;
            const badge = candidateBadge(candidate, request, candidateSummary);
            const idle = idleToday(candidate.engineer, candidateSummary);
            const info = candidateInfo(
              candidate,
              candidateSummary
                ? {
                    summary: candidateSummary,
                    free: upcoming(
                      freeAt(
                        stopsOf(id),
                        positionOf(id, candidateSummary),
                        candidate.engineer.shiftStart,
                      ),
                    ),
                  }
                : null,
            );
            let mark = null;
            if (badge) {
              mark = (
                <ToneChip tone={badge.tone} icon={badge.ok ? CircleCheck : CircleX} size="sm">
                  {badge.text}
                </ToneChip>
              );
            } else if (state?.loading) {
              mark = <Spinner size={16} label="Проверяем" />;
            } else if (state?.failed) {
              mark = (
                <ToneChip tone="neutral" size="sm">
                  Не проверено
                </ToneChip>
              );
            }
            return (
              <button
                key={id}
                type="button"
                className={cx(styles.candidate, selected && styles.selected)}
                aria-pressed={selected}
                onClick={() => pick(id)}
              >
                <span
                  className={styles.dot}
                  style={{ background: candidate.engineer.color.css }}
                  aria-hidden
                />
                <span className={styles.name}>{candidate.engineer.label}</span>
                {(idle || info) && (
                  <span className={styles.info}>
                    {[idle ? 'вызов с выходного — решение диспетчера' : null, info].filter(Boolean).join(' · ')}
                  </span>
                )}
                {idle && (
                  <ToneChip tone="neutral" size="sm">
                    Не работает сегодня
                  </ToneChip>
                )}
                {mark}
              </button>
            );
          })}
        </div>

        {selectedId && (
          <Select
            label="Позиция в маршруте"
            value={shownPosition == null ? '' : String(shownPosition)}
            placeholder={shownPosition == null ? 'Лучшая позиция' : undefined}
            options={positionOptions(stops, shownPosition, summary?.newStart ?? null)}
            disabled={actions.reassign.isPending}
            onChange={(value) => {
              setPositions((prev) => ({ ...prev, [selectedId]: Number(value) }));
              setPicked(selectedId);
              setConfirming(false);
              setApplyError(null);
            }}
          />
        )}

        <CheckResult state={selectedCheck} />

        {summary?.newStart && nowMin != null && toMin(summary.newStart) < nowMin && (
          <Callout tone="warning" icon={TriangleAlert}>
            Начало {summary.newStart} — раньше текущего времени {model.now}: визит встанет в прошлое.
            Выберите позицию позже в маршруте или другую бригаду.
          </Callout>
        )}

        {summary?.newStart && selectedId && onPreview && (
          <div className={styles.previewRow}>
            <Button
              variant="secondary"
              size="sm"
              icon={GanttChart}
              onClick={() => {
                const draft = reassignDraft(base, {
                  requestId,
                  toEngineerId: selectedId,
                  newStart: summary.newStart as string,
                  shifted: summary.shifted,
                });
                const engineer = base.engineerById.get(selectedId);
                if (draft) {
                  onPreview({
                    kind: 'reassign',
                    ...draft,
                    caption: `Черновик: №${requestId} → ${engineer?.label ?? selectedId}, начало ${summary.newStart}`,
                  });
                }
              }}
            >
              Показать на таймлайне
            </Button>
          </div>
        )}

        {chips.length > 0 && (
          <div className={styles.chips}>
            {chips.map((chip) => (
              <span key={chip} className={styles.chip}>
                {chip}
              </span>
            ))}
          </div>
        )}

        {confirming && (
          <Callout tone="warning" icon={TriangleAlert}>
            Назначить с нарушением ограничений? План применится сразу, инженеры получат обновление.
          </Callout>
        )}
        {applyError && <Callout tone="danger">{applyError}</Callout>}
      </>
    );
  }

  const summary = selectedCheck?.summary ?? null;
  const pending = actions.reassign.isPending;
  let footer;
  if (confirming) {
    footer = (
      <>
        <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Назад
        </Button>
        <Button variant="danger" icon={TriangleAlert} loading={pending} onClick={() => apply(true)}>
          Применить с нарушением
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        {summary && !summary.feasible ? (
          <Button
            key="force"
            variant="secondary"
            icon={TriangleAlert}
            disabled={pending}
            onClick={() => {
              if (selectedId) setPicked(selectedId);
              setConfirming(true);
            }}
          >
            Применить с нарушением
          </Button>
        ) : (
          <Button
            key="apply"
            variant="primary"
            icon={Check}
            loading={pending}
            disabled={!summary}
            onClick={() => apply(false)}
          >
            Применить
          </Button>
        )}
      </>
    );
  }

  return (
    <Modal
      open={!hidden}
      width={560}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={footer}
      bodyClassName={styles.body}
    >
      {body}
    </Modal>
  );
}
