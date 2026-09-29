import { ArrowRight } from 'lucide-react';
import { currentVisit, type EngineerDayModel } from '@/adapters/engineerDay';
import { BottomSheet, Button, InfoGrid } from '@/ui';
import { AddressText, CardChips } from './VisitBits';
import { positionLabel, visitDetails } from './visitFacts';
import list from './VisitList.module.css';

/**
 * Заявка с карты (E-04): нажали на точку маршрута — шторка с заявкой: номер в маршруте, тип, статус,
 * адрес, окно, приезд. «Открыть заявку» — карточка E-03.1 с действиями. Заявки уже нет в дне
 * (передали другому) — шторку не показываем.
 */
export function VisitSheet({
  day,
  visitId,
  onClose,
  onOpen,
}: {
  day: EngineerDayModel;
  visitId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const visit = day.visits.find((item) => item.id === visitId);
  if (!visit) return null;
  const isCurrent = currentVisit(day)?.id === visit.id;
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={visit.title}
      subtitle={positionLabel(visit, isCurrent, day.total)}
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          iconRight={ArrowRight}
          onClick={() => onOpen(visit.id)}
        >
          Открыть заявку
        </Button>
      }
    >
      <div className={list.titleRow}>
        <CardChips visit={visit} />
      </div>
      <div className={list.address}>
        <AddressText address={visit.address} />
      </div>
      <InfoGrid items={visitDetails(visit)} />
    </BottomSheet>
  );
}
