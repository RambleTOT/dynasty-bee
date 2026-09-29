import type { CSSProperties, ReactNode } from 'react';
import { routeColorVar } from '@/lib/colors';
import { cx } from '@/ui';
import styles from './EngineerPage.module.css';

/**
 * Каркас экрана инженера: шапка 56 px, плашка «План изменён», контент, действия внизу.
 * `routeColor` — цвет маршрута инженера (§10.2) для кружков с номерами и линии на карте.
 */
export function EngineerPage({
  header,
  banner,
  footer,
  fill = false,
  routeColor = 1,
  children,
}: {
  header: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
  /** Экран по высоте окна без прокрутки (карта). */
  fill?: boolean;
  routeColor?: number;
  children: ReactNode;
}) {
  const style = { '--engineer-route': routeColorVar(routeColor) } as CSSProperties;
  return (
    <div className={cx(styles.page, fill && styles.fill)} style={style}>
      {header}
      {banner}
      <main className={styles.content}>{children}</main>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
