/**
 * DS-04 «Карточка заявки»: серый блок фактов, «Почему этот инженер» с тремя ограничениями и «Почему
 * не другие» (FRONTEND_SPEC §6.2, §8.2). Из списков и таймлайна — дровер, только для назначенных
 * (D-29). С карты — диалог: и для назначенной, и для неназначенной (причина, «Назначить вручную»),
 * и до плана (только факты).
 */
import { ArrowLeft, ArrowRightLeft, ChevronDown, ChevronUp, CircleCheck, CircleX, Lightbulb, ListChecks } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { assignmentSummary, constraintRows, otherEngineers, unassignedExplain } from '@/adapters/constraints';
import type { DayModel, DayRequest } from '@/adapters/dayModel';
import { formatKm } from '@/lib/format';
import { isRequestStatus } from '@/lib/statuses';
import { Button, Drawer, EmptyState, FlagChip, Modal, StatusChip, cx } from '@/ui';
import panel from './Panel.module.css';
import styles from './Overlays.module.css';

type CardView = 'drawer' | 'dialog';

interface ShellProps {
  as: CardView;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

function Shell({ as, title, subtitle, footer, onClose, children }: ShellProps) {
  return as === 'dialog' ? (
    <Modal open width={560} onClose={onClose} title={title} subtitle={subtitle} footer={footer}>
      {children}
    </Modal>
  ) : (
    <Drawer open onClose={onClose} title={title} subtitle={subtitle} footer={footer}>
      {children}
    </Drawer>
  );
}

interface Fact {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

function Chips({ request }: { request: DayRequest }) {
  return (
    <div className={styles.chipsRow}>
      {isRequestStatus(request.status) && <StatusChip status={request.status} />}
      {request.flags.map((flag) => (
        <FlagChip key={flag} flag={flag} />
      ))}
    </div>
  );
}

function Facts({ request, fields }: { request: DayRequest; fields: Fact[] }) {
  return (
    <dl className={styles.facts}>
      {fields.map((field) => (
        <div key={field.label} className={cx(styles.fact, field.wide && styles.factWide)}>
          <dt className={styles.factLabel}>{field.label}</dt>
          <dd className={cx(styles.factValue, field.label === 'Адрес' && !request.hasAddress && styles.tertiary)}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function gigabitOf(request: DayRequest): string | null {
  return request.raw.gigabit || request.technology
    ? [request.raw.gigabit ? 'да' : 'нет', request.technology].filter(Boolean).join(' · ')
    : null;
}

/** Карточка поверх предложения — только смотреть и вернуться к нему. */
function BackToProposal({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
      К предложению
    </Button>
  );
}

/** С карты: заявка без визита — неназначенная в плане или день без плана. */
function UnplannedCard({
  model,
  request,
  onClose,
  onReassign,
  onShowInList,
  onBack,
}: {
  model: DayModel;
  request: DayRequest;
  onClose: () => void;
  onReassign: (orderId: string) => void;
  onShowInList: (orderId: string) => void;
  onBack?: () => void;
}) {
  const gigabit = gigabitOf(request);
  const item = model.plan ? model.unassigned.find((u) => u.requestId === request.id) : undefined;
  const explain = item ? unassignedExplain(model, request, item.reasonCode, item.reason) : null;
  const closed = request.status === 'done' || request.status === 'cancelled';
  const fields: Fact[] = [
    { label: 'Адрес', value: request.addressText, wide: true },
    ...(request.district ? [{ label: 'Район', value: request.district }] : []),
    { label: 'Временное окно', value: request.windowFull },
    {
      label: 'Длительность',
      value: model.synthetic ? `${request.durationMinutes} мин` : `${request.durationMinutes} мин по нормативу`,
    },
    ...(gigabit && !model.synthetic ? [{ label: 'Гигабит · технология', value: gigabit }] : []),
    { label: 'Требуемый транспорт', value: request.requiredTransport ? request.requiredTransportLabel : 'Не требуется' },
    { label: 'Инженер', value: model.plan ? 'Не назначен' : 'План ещё не построен' },
  ];
  const ExplainIcon = explain?.icon;
  return (
    <Shell
      as="dialog"
      title={request.number}
      subtitle={request.typeFull}
      onClose={onClose}
      footer={
        onBack ? (
          <BackToProposal onBack={onBack} />
        ) : model.plan ? (
          <>
            <Button variant="ghost" icon={ListChecks} onClick={() => onShowInList(request.id)}>
              В списке неназначенных
            </Button>
            <Button
              variant="tertiary"
              icon={ArrowRightLeft}
              disabled={model.planState !== 'applied' || closed}
              onClick={() => onReassign(request.id)}
            >
              Назначить вручную
            </Button>
          </>
        ) : undefined
      }
    >
      <Chips request={request} />
      <Facts request={request} fields={fields} />
      {explain && ExplainIcon && (
        <section className={styles.section}>
          <h3 className={styles.h3}>Почему не назначена</h3>
          <div className={panel.unReason}>
            <ExplainIcon size={14} aria-hidden />
            <span>{explain.reason}</span>
          </div>
          {explain.help && (
            <div className={panel.unHelp}>
              <Lightbulb size={14} aria-hidden />
              <span>
                <b>Что поможет:</b> {explain.help}
              </span>
            </div>
          )}
        </section>
      )}
    </Shell>
  );
}

export function RequestDrawer({
  model,
  requestId,
  as = 'drawer',
  onClose,
  onCancel,
  onReassign,
  onShowInList,
  onBack,
}: {
  model: DayModel;
  requestId: string;
  /** Дровер — из списков и таймлайна; диалог — с карты и из предложения. */
  as?: CardView;
  onClose: () => void;
  onCancel: (orderId: string) => void;
  onReassign: (orderId: string) => void;
  /** Диалог неназначенной: к ней во вкладке «Неназначенные». */
  onShowInList?: (orderId: string) => void;
  /** Открыта из предложения: только смотреть, внизу — «К предложению». */
  onBack?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const request = model.requestById.get(requestId);
  const visit = request?.visit ?? null;
  const engineer = request?.engineerId ? model.engineerById.get(request.engineerId) : null;

  if (request && (!visit || !engineer) && as === 'dialog') {
    return (
      <UnplannedCard
        model={model}
        request={request}
        onClose={onClose}
        onReassign={onReassign}
        onShowInList={onShowInList ?? (() => undefined)}
        onBack={onBack}
      />
    );
  }

  if (!request || !visit || !engineer) {
    return (
      <Shell
        as={as}
        title={`№${requestId}`}
        onClose={onClose}
        footer={onBack && <BackToProposal onBack={onBack} />}
      >
        {onBack ? (
          <EmptyState title="Заявка есть только в предложении">
            Её карточка появится в плане после «Принять изменения».
          </EmptyState>
        ) : (
          <EmptyState title="Заявка не найдена в текущей версии плана">
            Возможно, её сняли или передали в другую версию. Обновите день.
          </EmptyState>
        )}
      </Shell>
    );
  }

  const route = model.routeByEngineer.get(engineer.id);
  const position = (route?.visits.findIndex((v) => v.requestId === request.id) ?? -1) + 1;
  const explanation = model.explanations.get(request.id);
  const rows = constraintRows(visit, request, engineer);
  const others = otherEngineers(model, request, explanation);
  const reasons = explanation?.reasons ?? [];
  const canEdit = model.planState === 'applied';
  const closed = request.status === 'done' || request.status === 'cancelled';
  const gigabit = gigabitOf(request);

  const fields: Fact[] = [
    { label: 'Адрес', value: request.addressText, wide: true },
    ...(request.district ? [{ label: 'Район', value: request.district }] : []),
    { label: 'Временное окно', value: request.windowFull },
    { label: 'Приезд · начало · окончание', value: `${visit.arrival} · ${visit.start} · ${visit.end}` },
    {
      label: 'Длительность',
      value: model.synthetic ? `${request.durationMinutes} мин` : `${request.durationMinutes} мин по нормативу`,
    },
    ...(gigabit && !model.synthetic ? [{ label: 'Гигабит · технология', value: gigabit }] : []),
    { label: 'Требуемый транспорт', value: request.requiredTransport ? request.requiredTransportLabel : 'Не требуется' },
    {
      label: 'Инженер',
      value: (
        <>
          <span className={cx(styles.dot, styles[`c${engineer.color.index}`])} aria-hidden />
          {engineer.label} · {engineer.transportLabel.toLowerCase()}
        </>
      ),
    },
    {
      label: '№ в маршруте · от предыдущей',
      value: `${position || visit.sequence} из ${route?.visits.length ?? '—'} · ${formatKm(visit.legKm)} км`,
    },
  ];

  return (
    <Shell
      as={as}
      onClose={onClose}
      title={request.number}
      subtitle={request.typeFull}
      footer={
        onBack ? (
          <BackToProposal onBack={onBack} />
        ) : (
        <>
          <Button
            variant="danger"
            icon={CircleX}
            disabled={!canEdit || closed}
            onClick={() => onCancel(request.id)}
          >
            Отменить заявку
          </Button>
          <Button
            variant="tertiary"
            icon={ArrowRightLeft}
            disabled={!canEdit || closed}
            onClick={() => onReassign(request.id)}
          >
            Переназначить
          </Button>
        </>
        )
      }
    >
      <Chips request={request} />
      <Facts request={request} fields={fields} />
      <section className={styles.section}>
        <h3 className={styles.h3}>Почему этот инженер</h3>
        <p className={styles.body}>{assignmentSummary(visit, request, engineer)}</p>
        <button type="button" className={styles.more} aria-expanded={details} onClick={() => setDetails((v) => !v)}>
          Подробнее
          {details ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>
        {details && (
          <>
            <div className={styles.checks}>
              {rows.map((row) => (
                <div key={row.key} className={styles.check}>
                  <span className={row.ok ? styles.ok : styles.bad}>
                    {row.ok ? <CircleCheck size={18} aria-label="соблюдено" /> : <CircleX size={18} aria-label="нарушено" />}
                  </span>
                  <div>
                    <div className={styles.checkTitle}>{row.label}</div>
                    <div className={styles.caption}>{row.text}</div>
                  </div>
                </div>
              ))}
            </div>
            {reasons.length > 0 && (
              <ul className={styles.reasons}>
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {others.length > 0 && (
          <>
            <div className={styles.subhead}>Почему не другие</div>
            {others.map((other) => (
              <div key={other.engineerId} className={styles.other}>
                <span className={cx(styles.dot, styles[`c${other.color.index}`])} aria-hidden />
                <span className={styles.otherName}>{other.label}</span>
                <span className={styles.caption}>— {other.reason}</span>
              </div>
            ))}
          </>
        )}
      </section>
    </Shell>
  );
}
