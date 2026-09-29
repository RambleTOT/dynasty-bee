import { Info, RefreshCw } from 'lucide-react';
import type { EngineerBannerModel } from '@/adapters/engineerDay';
import { Button, DarkBanner } from '@/ui';
import styles from './EngineerPage.module.css';

/**
 * E-09: тёмная плашка под шапкой — «План изменён», текст бэка (DESIGN_SPEC §7.4) и «Посмотреть».
 * Тексты собирает бэк ⏳ 8.1, фронт их не составляет.
 */
export function PlanChangedBanner({
  banner,
  onView,
}: {
  banner: EngineerBannerModel;
  onView: () => void;
}) {
  return (
    <DarkBanner
      layout="card"
      icon={RefreshCw}
      className={styles.banner}
      title={<span className={styles.bannerTitle}>План изменён</span>}
      action={
        <Button variant="secondary" size="sm" onClick={onView}>
          Посмотреть
        </Button>
      }
    >
      {banner.text}
    </DarkBanner>
  );
}

/**
 * «Не могу работать» принят, а баннера от бэка нет (§9.1): «С {available_until} ваши заявки
 * передадут другим после решения диспетчера».
 */
export function UnavailableBanner({ availableUntil }: { availableUntil: string | null }) {
  const text = availableUntil
    ? `С ${availableUntil} ваши заявки передадут другим после решения диспетчера`
    : 'Ваши заявки передадут другим после решения диспетчера';
  return (
    <DarkBanner
      layout="card"
      icon={Info}
      className={styles.banner}
      title={<span className={styles.bannerTitle}>{text}</span>}
    />
  );
}
