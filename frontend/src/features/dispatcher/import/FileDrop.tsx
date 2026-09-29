import { FileCheck2, X, type LucideIcon } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { cx, IconButton } from '@/ui';
import styles from './ImportModal.module.css';

export interface PickedFileView {
  name: string;
  /** «66 строк · 48 КБ» / «Контрольное распределение · 66 строк». */
  meta: string;
}

/**
 * Зона файла в карточке региона (DS-02): перетащить или выбрать .csv. Выбран — имя, строки и ✕.
 */
export function FileDrop({
  label,
  hint,
  icon: Icon,
  inputLabel,
  picked,
  disabled = false,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Подпись поля выбора файла для скринридера: «Файл заявок (.csv) · Восток». */
  inputLabel: string;
  picked: PickedFileView | null;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (disabled) return;
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !disabled) onPick(file);
  }

  return (
    <div
      className={cx(styles.drop, !picked && styles.dropEmpty, over && styles.dropOver)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className={styles.fileInput}
        aria-label={inputLabel}
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ''; // тот же файл ещё раз — снова событие
          if (file) onPick(file);
        }}
      />
      {picked ? (
        <>
          <span className={cx(styles.fileIcon, styles.fileIconDone)}>
            <FileCheck2 size={18} aria-hidden />
          </span>
          <span className={styles.fileText}>
            <span className={styles.fileTitle} title={picked.name}>
              {picked.name}
            </span>
            <span className={styles.fileSub}>{picked.meta}</span>
          </span>
          <IconButton
            icon={X}
            label="Убрать файл"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onClear}
          />
        </>
      ) : (
        <button
          type="button"
          className={styles.dropButton}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <span className={styles.fileIcon}>
            <Icon size={18} aria-hidden />
          </span>
          <span className={styles.fileText}>
            <span className={styles.fileTitle}>{label}</span>
            <span className={styles.fileSub}>{hint}</span>
          </span>
        </button>
      )}
    </div>
  );
}
