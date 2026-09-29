/**
 * DS-09 «Состав и ресурсы» (FRONTEND_SPEC §8.2, §5.4): бригады дня с транспортом и «В день», добавление
 * бригады, «Пересчитать план».
 * - До публикации: PATCH изменённых и POST новых → расчёт плана (для дня без плана — сразу с публикацией, D-25).
 * - После: по одному изменению за раз [Д] — событие `apply: false` → предложение (DS-07). Добавить бригаду
 *   после публикации — событие `engineer_added`, только при `FEATURES.addEngineerAfterPublish` (P1-6).
 * - Рекомендация «не хватает +N инженера» — только по кнопке, с бригадой-кандидатом (`params.engineer`).
 *   С P1-5 — `extend-resource/check` без сохранения, и кандидата можно добавить в состав; без P1-5
 *   `extend-resource` при `apply: false` сохраняет предложение — «Открыть предложение» (DS-07).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addEngineers, getScenarioEngineers, patchEngineer } from '@/api/data';
import { errorMessage } from '@/api/errors';
import { checkExtendResource, extendResource, runPlan } from '@/api/planning';
import { queryKeys } from '@/api/queryKeys';
import type { ReplanResult } from '@/api/types';
import type { DayModel } from '@/adapters/dayModel';
import {
  commonShift,
  createdEngineerId,
  EMPTY_DRAFT,
  engineerAddedEvent,
  extraEngineer,
  pendingLock,
  resourceAdvice,
  rosterDiff,
  rosterEvent,
  rosterRows,
  setChange,
  transportOptions,
  validateNewEngineer,
  type NewEngineer,
  type RosterDiff,
  type RosterDraft,
  type RosterRow,
} from '@/adapters/roster';
import { FEATURES } from '@/config';
import {
  regionLabel,
  SKILL_SHORT,
  TRANSPORT_ICON,
  transportLabel,
  TRANSPORT_SHORT,
} from '@/lib/dictionaries';
import { countOf, formatDayTitle, plural, PL_BRIGADE, PL_REQUEST } from '@/lib/format';
import { notify } from '@/lib/notify';
import { isTransport, labelOf, SKILL_LABEL, type Skill } from '@/lib/statuses';
import { windowFull } from '@/lib/time';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Drawer,
  IconButton,
  Input,
  Select,
  Switch,
  cx,
} from '@/ui';
import { versionAppliedText, type DayActions } from './useDayActions';
import styles from './RosterDrawer.module.css';

const SKILL_ORDER: readonly Skill[] = ['installation', 'local', 'emergency'];
const PL_NOT_ASSIGNED = ['Не назначена', 'Не назначены', 'Не назначено'] as const;

const transportIcon = (transport: string) =>
  isTransport(transport) ? TRANSPORT_ICON[transport] : undefined;

function AddEngineerForm({
  defaultShift,
  initial,
  onAdd,
  onCancel,
}: {
  defaultShift: { start: string; end: string } | null;
  /** Бригада-кандидат из рекомендации: навыки, транспорт и смена уже заполнены. */
  initial?: Omit<NewEngineer, 'key' | 'name'> | null;
  onAdd: (engineer: Omit<NewEngineer, 'key'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [transport, setTransport] = useState(initial?.transport ?? 'car');
  const [shiftStart, setShiftStart] = useState(initial?.shiftStart ?? defaultShift?.start ?? '');
  const [shiftEnd, setShiftEnd] = useState(initial?.shiftEnd ?? defaultShift?.end ?? '');
  const [touched, setTouched] = useState(false);
  const engineer = { name, skills, transport, shiftStart, shiftEnd };
  const errors = touched ? validateNewEngineer(engineer) : {};

  const submit = () => {
    setTouched(true);
    if (Object.keys(validateNewEngineer(engineer)).length === 0) onAdd(engineer);
  };

  return (
    <div className={styles.addForm} role="group" aria-label="Новый инженер">
      <Input
        label="Имя"
        size="sm"
        tone="white"
        autoFocus
        value={name}
        placeholder="Например, Бригада Иванов"
        error={errors.name}
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className={styles.skillsField}>
        <legend className={styles.legend}>Навыки</legend>
        <div className={styles.skillsList}>
          {SKILL_ORDER.map((skill) => (
            <Checkbox
              key={skill}
              label={SKILL_LABEL[skill]}
              checked={skills.includes(skill)}
              onChange={(on) =>
                setSkills((prev) => (on ? [...prev, skill] : prev.filter((s) => s !== skill)))
              }
            />
          ))}
        </div>
        {errors.skills && <span className={styles.fieldError}>{errors.skills}</span>}
      </fieldset>
      <div className={styles.addGrid}>
        <Select
          label="Транспорт"
          size="sm"
          tone="white"
          icon={transportIcon(transport)}
          value={transport}
          options={transportOptions(transport)}
          onChange={setTransport}
        />
        <Input
          label="Смена с"
          size="sm"
          tone="white"
          type="time"
          value={shiftStart}
          aria-invalid={errors.shift ? true : undefined}
          onChange={(event) => setShiftStart(event.target.value)}
        />
        <Input
          label="до"
          size="sm"
          tone="white"
          type="time"
          value={shiftEnd}
          aria-invalid={errors.shift ? true : undefined}
          onChange={(event) => setShiftEnd(event.target.value)}
        />
      </div>
      {errors.shift && <span className={styles.fieldError}>{errors.shift}</span>}
      <div className={styles.addActions}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button variant="tertiary" size="sm" icon={Plus} onClick={submit}>
          Добавить в состав
        </Button>
      </div>
    </div>
  );
}

function EngineerRow({
  row,
  draft,
  lockTransport,
  lockAvailable,
  onChange,
}: {
  row: RosterRow;
  draft: RosterDraft;
  lockTransport: boolean;
  lockAvailable: boolean;
  onChange: (next: RosterDraft) => void;
}) {
  const change = draft.changes[row.id];
  const transport = change?.transport ?? row.transport;
  const available = change?.available ?? row.available;
  return (
    <div className={cx(styles.row, !available && styles.off)}>
      <div className={styles.who}>
        <div className={styles.nameLine}>
          <span className={styles.dot} style={{ background: row.color.css }} aria-hidden />
          <span className={styles.name}>{row.label}</span>
        </div>
        {row.skillChips.length > 0 && (
          <div className={styles.skills}>
            {row.skillChips.map((skill) => (
              <span key={skill} className={styles.skill}>
                {skill}
              </span>
            ))}
          </div>
        )}
      </div>
      <Select
        size="sm"
        icon={transportIcon(transport)}
        value={transport}
        options={transportOptions(transport)}
        disabled={lockTransport}
        aria-label={`Транспорт: ${row.label}`}
        className={styles.transport}
        onChange={(value) => onChange(setChange(draft, row, 'transport', value))}
      />
      <span className={styles.shift}>{row.shiftText}</span>
      <Switch
        checked={available}
        disabled={lockAvailable}
        label={<span className={styles.srOnly}>В день: {row.label}</span>}
        onChange={(on) => onChange(setChange(draft, row, 'available', on))}
      />
    </div>
  );
}

type PublishedResult = { kind: 'event'; result: ReplanResult } | { kind: 'missing' };

export function RosterDrawer({
  model,
  withAddForm,
  actions,
  onProposal,
  onClose,
}: {
  model: DayModel;
  /** Открыть сразу с формой «+ Добавить инженера». */
  withAddForm: boolean;
  actions: DayActions;
  /** После события состава (день начат) — открыть DS-07 по предложению. */
  onProposal: (planId: string) => void;
  onClose: () => void;
}) {
  const published = model.planState === 'applied';
  const canAdd = !published || FEATURES.addEngineerAfterPublish;
  const scenarioId = model.scenarioId;

  const fallback = useMemo(() => model.engineers.map((e) => e.raw), [model.engineers]);
  const rosterQuery = useQuery({
    queryKey: queryKeys.scenarioEngineers(scenarioId),
    queryFn: ({ signal }) => getScenarioEngineers(scenarioId, signal),
    placeholderData: fallback,
  });
  const rows = useMemo(() => rosterRows(rosterQuery.data, model), [rosterQuery.data, model]);

  const [draft, setDraft] = useState<RosterDraft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(withAddForm && canAdd);
  const [error, setError] = useState<string | null>(null);
  const diff = useMemo(() => rosterDiff(rows, draft), [rows, draft]);
  const lock = published ? pendingLock(rows, draft) : null;

  const onFail = (failure: unknown) => {
    setError(errorMessage(failure));
    void actions.invalidate();
  };

  /** Черновик дня из записей оператора: новый расчёт без публикации — её делает «Начать рабочий день». */
  const rerun = useMutation({
    mutationFn: () => runPlan(scenarioId),
    onSuccess: async () => {
      await actions.invalidate();
      notify('План пересчитан', 'success');
      onClose();
    },
    onError: onFail,
  });

  /** День без плана — как «Построить план»: расчёт и сразу публикация (D-25). */
  const recalc = () => {
    if (model.planState === 'none')
      actions.buildPlan.mutate(scenarioId, { onSuccess: () => onClose() });
    else rerun.mutate();
  };

  /**
   * До публикации: PATCH по бригадам, затем POST новых. После сбоя ростер перечитываем: применённые
   * правки совпадут с ним и из диффа выпадут, а новые бригады из черновика убираем сразу после POST.
   */
  const saveDraft = useMutation({
    mutationFn: async (changes: RosterDiff) => {
      for (const { engineerId, patch } of changes.patches) {
        await patchEngineer(scenarioId, engineerId, patch);
      }
      if (changes.additions.length > 0) {
        await addEngineers(scenarioId, changes.additions);
        setDraft((prev) => ({ ...prev, additions: [] }));
      }
    },
    onSuccess: recalc,
    onError: onFail,
  });

  /** После публикации: одно изменение → событие `apply: false` → предложение. */
  const sendChange = useMutation({
    mutationFn: async (changes: RosterDiff): Promise<PublishedResult> => {
      const planId = model.planId as string;
      let event = rosterEvent(changes, planId, model.now);
      if (!event && changes.additions.length === 1 && FEATURES.addEngineerAfterPublish) {
        event = engineerAddedEvent(changes.additions[0], planId, model.now, model.office?.point ?? null);
        const result = await actions.sendEvent.mutateAsync(event);
        setDraft(EMPTY_DRAFT);
        return { kind: 'event', result };
      }
      if (!event && changes.additions.length === 1) {
        // бэк без P1-6: бригада в сценарий, затем «снова доступен» (после публикации бэк ответит 409)
        const before = rows.map((r) => r.id);
        await addEngineers(scenarioId, changes.additions);
        setDraft(EMPTY_DRAFT);
        const engineerId = createdEngineerId(
          before,
          await getScenarioEngineers(scenarioId),
          changes.additions[0].name,
        );
        if (!engineerId) return { kind: 'missing' };
        event = {
          type: 'engineer_available',
          plan_id: planId,
          event_time: model.now,
          engineer_id: engineerId,
        };
      }
      if (!event) return { kind: 'missing' };
      return { kind: 'event', result: await actions.sendEvent.mutateAsync(event) };
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'missing') {
        setError('Бригада добавлена, но не найдена в составе дня. Обновите страницу');
        void actions.invalidate();
        return;
      }
      if (outcome.result.status === 'proposed') {
        onProposal(outcome.result.plan.plan_id);
      } else {
        notify(versionAppliedText(model.version + 1), 'success');
        onClose();
      }
    },
    onError: onFail,
  });

  /** Неназначенные действующего плана: для них — расчёт добора ресурса (только после публикации [Д]). */
  const orderIds = useMemo(
    () =>
      model.unassigned
        .map((u) => u.requestId)
        .filter((id) => model.requestById.get(id)?.status === 'unassigned'),
    [model.unassigned, model.requestById],
  );
  const candidate = useMemo(
    () =>
      extraEngineer(
        orderIds.flatMap((id) => model.requestById.get(id) ?? []),
        rows,
        model.office?.point ?? null,
      ),
    [orderIds, model.requestById, model.office, rows],
  );
  const advise = useMutation({
    mutationFn: async () => {
      const engineer = candidate as NonNullable<typeof candidate>;
      const planId = model.planId as string;
      return FEATURES.extendResourceCheck
        ? checkExtendResource(planId, orderIds, engineer)
        : extendResource(planId, orderIds, engineer);
    },
    // без P1-5 предложение уже сохранено на бэке — пусть появится в баннере и ленте
    onSuccess: () => {
      if (!FEATURES.extendResourceCheck) void actions.invalidate();
    },
    onError: onFail,
  });
  const advice =
    advise.data && candidate ? resourceAdvice(advise.data, orderIds.length, candidate) : null;
  const showAdvice = published && Boolean(model.planId) && orderIds.length > 0 && candidate != null;
  // кандидата из рекомендации — в форму «+ Добавить инженера» (после публикации — событие P1-6)
  const [prefill, setPrefill] = useState<Omit<NewEngineer, 'key' | 'name'> | null>(null);
  const canAddCandidate =
    FEATURES.extendResourceCheck && canAdd && Boolean(advice?.helps) && candidate != null;

  const busy =
    saveDraft.isPending ||
    rerun.isPending ||
    sendChange.isPending ||
    advise.isPending ||
    actions.buildPlan.isPending;

  const submit = () => {
    setError(null);
    if (published) sendChange.mutate(diff);
    else if (diff.count > 0) saveDraft.mutate(diff);
  };

  const addEngineer = (engineer: Omit<NewEngineer, 'key'>) => {
    setDraft((prev) => ({
      ...prev,
      additions: [
        ...prev.additions,
        { ...engineer, key: `new-${Date.now().toString(36)}-${prev.additions.length}` },
      ],
    }));
    setAdding(false);
  };

  const shownAdditions = draft.additions;
  const canOpenForm = canAdd && !adding && !busy && (!published || lock == null);
  const note = published
    ? 'Изменения станут событием и придут предложением'
    : model.planState === 'none'
      ? 'План будет построен и опубликован с новым составом'
      : 'Черновик плана будет пересчитан с новым составом';

  return (
    <Drawer
      open
      width={560}
      onClose={onClose}
      title="Состав и ресурсы"
      subtitle={`${regionLabel(model.regionId)} · ${formatDayTitle(model.date)} · ${countOf(rows.length, PL_BRIGADE)}`}
      bodyClassName={styles.body}
      footer={
        <>
          <span className={styles.footNote}>{note}</span>
          <Button
            variant="primary"
            icon={RefreshCw}
            loading={busy}
            disabled={diff.count === 0}
            onClick={submit}
          >
            Пересчитать план
          </Button>
        </>
      }
    >
      {rosterQuery.isError && (
        <Callout
          tone="warning"
          action={
            <Button variant="ghost" size="sm" onClick={() => void rosterQuery.refetch()}>
              Повторить
            </Button>
          }
        >
          Не удалось обновить состав бригад
        </Callout>
      )}
      {showAdvice &&
        (advice ? (
          <Callout
            tone={advice.tone}
            action={
              advice.proposalId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => advice.proposalId && onProposal(advice.proposalId)}
                >
                  Открыть предложение
                </Button>
              ) : (
                canAddCandidate &&
                candidate && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Plus}
                    disabled={!canOpenForm}
                    onClick={() => {
                      setPrefill({
                        skills: candidate.skills,
                        transport: candidate.transport,
                        shiftStart: candidate.shift_start,
                        shiftEnd: candidate.shift_end,
                      });
                      setAdding(true);
                    }}
                  >
                    Добавить такую бригаду
                  </Button>
                )
              )
            }
          >
            {advice.text}
          </Callout>
        ) : (
          <Callout
            tone="info"
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={advise.isPending}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  advise.mutate();
                }}
              >
                Рассчитать, кого не хватает
              </Button>
            }
          >
            {plural(orderIds.length, PL_NOT_ASSIGNED)} {countOf(orderIds.length, PL_REQUEST)}
          </Callout>
        ))}
      {error && <Callout tone="danger">{error}</Callout>}

      <div className={styles.table}>
        <div className={cx(styles.row, styles.headRow)} aria-hidden>
          <span>ИНЖЕНЕР · НАВЫКИ</span>
          <span>ТРАНСПОРТ</span>
          <span>СМЕНА</span>
          <span>В ДЕНЬ</span>
        </div>
        {rows.map((row) => {
          const own = lock?.kind === 'engineer' && lock.engineerId === row.id;
          const locked = busy || (lock != null && !own);
          return (
            <EngineerRow
              key={row.id}
              row={row}
              draft={draft}
              lockTransport={locked || (own && lock.field !== 'transport')}
              lockAvailable={locked || (own && lock.field !== 'available')}
              onChange={(next) => {
                setError(null);
                setDraft(next);
              }}
            />
          );
        })}
        {shownAdditions.map((engineer) => (
          <div key={engineer.key} className={styles.row}>
            <div className={styles.who}>
              <div className={styles.nameLine}>
                <Badge micro>Новая</Badge>
                <span className={styles.name}>{engineer.name.trim()}</span>
              </div>
              <div className={styles.skills}>
                {engineer.skills.map((skill) => (
                  <span key={skill} className={styles.skill}>
                    {labelOf(SKILL_SHORT, skill)}
                  </span>
                ))}
              </div>
            </div>
            <span className={styles.plain}>
              {isTransport(engineer.transport)
                ? TRANSPORT_SHORT[engineer.transport]
                : transportLabel(engineer.transport)}
            </span>
            <span className={styles.shift}>
              {windowFull(engineer.shiftStart, engineer.shiftEnd)}
            </span>
            <IconButton
              icon={X}
              label={`Убрать: ${engineer.name.trim()}`}
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  additions: prev.additions.filter((a) => a.key !== engineer.key),
                }))
              }
            />
          </div>
        ))}
      </div>

      {published && lock && (
        <p className={styles.hint}>После публикации — по одному изменению за раз</p>
      )}

      {adding ? (
        <AddEngineerForm
          defaultShift={commonShift(rows)}
          initial={prefill}
          onAdd={(engineer) => {
            setPrefill(null);
            addEngineer(engineer);
          }}
          onCancel={() => {
            setPrefill(null);
            setAdding(false);
          }}
        />
      ) : (
        canAdd && (
          <div className={styles.addRow}>
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              disabled={!canOpenForm}
              onClick={() => setAdding(true)}
            >
              Добавить инженера
            </Button>
          </div>
        )
      )}
    </Drawer>
  );
}
