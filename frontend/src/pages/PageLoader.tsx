import { Spinner } from '@/ui';
import styles from './pages.module.css';

export function PageLoader() {
  return (
    <div className={styles.center}>
      <Spinner size={24} label="Загрузка…" />
    </div>
  );
}
