import { Pencil } from 'lucide-react';
import type { SlotsModel } from '@/adapters/booking';
import { Button, Card, InfoGrid, type InfoItem } from '@/ui';
import { T } from '../operatorTexts';
import { SkillLine } from './SkillLine';
import styles from './BookingSummary.module.css';

/**
 * Левая карточка шага «Дата и окно» (O-01.2) и переноса (O-02.1): сводка заявки на сером блоке,
 * под ней — строка навыка. `onEdit` — ghost «Изменить» → шаг 1.
 */
export function BookingSummary({
  title,
  rows,
  slots,
  onEdit,
}: {
  title: string;
  rows: readonly (InfoItem | null | false | undefined)[];
  slots?: SlotsModel;
  onEdit?: () => void;
}) {
  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {onEdit && (
          <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
            {T.new.edit}
          </Button>
        )}
      </div>
      <InfoGrid items={rows} columns={1} />
      <SkillLine slots={slots} />
    </Card>
  );
}
