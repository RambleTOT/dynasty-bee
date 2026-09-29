import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton, Logo } from '@/ui';
import styles from './EngineerPage.module.css';

/**
 * Шапка 56 px (§9.1): логотип, имя инженера, меню ⋯; на карточке заявки слева «←».
 * Под именем — регион и дата дня: номера бригад в регионах совпадают («Бригада 10» есть в каждом).
 */
export function EngineerHeader({
  name,
  sub,
  menu,
  onBack,
}: {
  name: string;
  /** «Восток · 29 сентября». */
  sub?: string | null;
  menu?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <header className={styles.header}>
      {onBack && (
        <IconButton icon={ArrowLeft} label="Назад" variant="ghost" size="lg" onClick={onBack} />
      )}
      <Logo size={28} wordmark={false} />
      <span className={styles.titles}>
        <span className={styles.name}>{name}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
      {menu}
    </header>
  );
}
