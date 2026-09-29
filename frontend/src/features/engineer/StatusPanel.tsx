import { CircleCheck, Navigation, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import type { EngineerVisitModel } from '@/adapters/engineerDay';
import type { EngineerAction } from '@/api/types';
import { FEATURES } from '@/config';
import { Button } from '@/ui';
import { useActionPending, useEngineerAction } from './useEngineerDay';
import styles from './VisitList.module.css';

interface Step {
  action: EngineerAction;
  label: string;
  icon: LucideIcon;
}

/** Следующий шаг по статусу текущей заявки (§9.2 E-03). */
const STEPS: Partial<Record<EngineerVisitModel['status'], Step>> = {
  planned: { action: 'en_route', label: 'Отправиться в путь', icon: Navigation },
  en_route: { action: 'start', label: 'Взять в работу', icon: Wrench },
  in_progress: { action: 'complete', label: 'Выполнить задачу', icon: CircleCheck },
};

/**
 * Панель статуса текущей заявки: primary — следующий шаг, под ней «Инцидент» ⏳ и «Прервать»;
 * без действия `incident` в API — «Прервать» на всю ширину. «Взять в работу» раньше окна не
 * блокируем (D-09). Пока идёт любое действие — кнопки неактивны.
 * `completeOnly` — «Не могу работать» (§9.1): только «Выполнить задачу» у заявки в работе.
 */
export function StatusPanel({
  visit,
  completeOnly = false,
  onInterrupt,
  onIncident,
  onStep,
}: {
  visit: EngineerVisitModel;
  completeOnly?: boolean;
  onInterrupt: () => void;
  onIncident: () => void;
  /** Нажали кнопку шага — до ответа бэка (карточка заявки после «Выполнить» ведёт к списку). */
  onStep?: (action: EngineerAction) => void;
}) {
  const action = useEngineerAction();
  const pending = useActionPending();
  const step = STEPS[visit.status];
  if (!step || (completeOnly && visit.status !== 'in_progress')) return null;

  const run = () => {
    action.mutate({ action: step.action, request_id: visit.id });
    onStep?.(step.action);
  };

  const interrupt = (
    <Button variant="danger" size="lg" fullWidth disabled={pending} onClick={onInterrupt}>
      Прервать
    </Button>
  );

  return (
    <div className={styles.actions}>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        icon={step.icon}
        loading={pending}
        onClick={run}
      >
        {step.label}
      </Button>
      {!completeOnly &&
        (FEATURES.engineerIncident ? (
          <div className={styles.pair}>
            <Button
              variant="tertiary"
              size="lg"
              fullWidth
              icon={TriangleAlert}
              disabled={pending}
              onClick={onIncident}
            >
              Инцидент
            </Button>
            {interrupt}
          </div>
        ) : (
          interrupt
        ))}
    </div>
  );
}
