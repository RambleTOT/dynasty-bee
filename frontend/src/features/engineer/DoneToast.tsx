import { CircleCheck } from 'lucide-react';
import { useDoneToast } from './doneToastStore';
import styles from './EngineerPage.module.css';

/** Тост успеха после «Выполнить задачу» (кадр E-03.3): белая карточка под шапкой, 4 с. */
export function DoneToast() {
  const toast = useDoneToast();
  if (!toast) return null;
  return (
    <div className={styles.doneToast} role="status" aria-live="polite">
      <CircleCheck size={20} className={styles.doneIcon} aria-hidden />
      <div className={styles.doneText}>
        <div className={styles.doneTitle}>{toast.title}</div>
        {toast.description && <div className={styles.doneDescription}>{toast.description}</div>}
      </div>
    </div>
  );
}
