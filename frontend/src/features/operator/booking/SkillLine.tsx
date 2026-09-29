import { Wrench } from 'lucide-react';
import type { SlotsModel } from '@/adapters/booking';
import { T } from '../operatorTexts';
import styles from './SkillLine.module.css';

/**
 * «Навык: Подключение и дозаказ · 70 мин на адресе» — из ответа /booking/slots, длительности на
 * фронте не зашиты. До ответа и при ошибке строки нет (FRONTEND_SPEC §8.3.7).
 */
export function SkillLine({ slots }: { slots?: SlotsModel }) {
  if (!slots?.skill || slots.duration === null) return null;
  return (
    <p className={styles.line}>
      <Wrench size={16} aria-hidden />
      {T.new.skill(slots.skill, slots.duration)}
    </p>
  );
}
