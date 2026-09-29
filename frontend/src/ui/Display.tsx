import type { HTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';
import styles from './Display.module.css';

/** Карточка-поверхность: белая 24 px или вложенная 12 px (дизайн-система: Card). */
export function Card({
  tone = 'surface',
  padding = 'lg',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  tone?: 'surface' | 'nested' | 'inverse';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}) {
  return (
    <section
      className={cx(styles.card, styles[tone], styles[`pad_${padding}`], className)}
      {...rest}
    >
      {children}
    </section>
  );
}

export type DeltaTone = 'success' | 'danger' | 'warning' | 'neutral';

/** Метрика: подпись, крупное значение, Δ; `highlight` — жёлтая плашка ключевой метрики. */
export function Metric({
  label,
  value,
  unit,
  delta,
  deltaTone = 'neutral',
  note,
  highlight = false,
  size = 'lg',
  className,
}: {
  label?: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  /** Подпись под значением без цвета: «оценка», «из 63 назначенных». */
  note?: ReactNode;
  highlight?: boolean;
  size?: 'lg' | 'md';
  className?: string;
}) {
  return (
    <div className={cx(styles.metric, highlight && styles.highlight, className)}>
      {label && <span className={styles.metricLabel}>{label}</span>}
      <span className={styles.metricValueRow}>
        <span className={size === 'lg' ? styles.metricValue : styles.metricValueMd}>{value}</span>
        {unit && <span className={styles.metricUnit}>{unit}</span>}
      </span>
      {delta && (
        <span className={cx(styles.delta, !highlight && styles[`delta_${deltaTone}`])}>
          {delta}
        </span>
      )}
      {note && <span className={styles.metricNote}>{note}</span>}
    </div>
  );
}

export interface InfoItem {
  label: ReactNode;
  value: ReactNode;
  /** На всю ширину блока. */
  wide?: boolean;
}

/** Серый блок «подпись — значение» в 2 колонки (DS-04, карточка оператора, E-03.1). */
export function InfoGrid({
  items,
  columns = 2,
  className,
}: {
  items: readonly (InfoItem | null | false | undefined)[];
  columns?: 1 | 2;
  className?: string;
}) {
  const visible = items.filter((item): item is InfoItem => Boolean(item));
  return (
    <dl className={cx(styles.info, columns === 1 && styles.infoSingle, className)}>
      {visible.map((item, index) => (
        <div key={index} className={cx(styles.infoItem, item.wide && styles.infoWide)}>
          <dt className={styles.infoLabel}>{item.label}</dt>
          <dd className={styles.infoValue}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TableColumn<Row> {
  key: string;
  title: ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render: (row: Row) => ReactNode;
}

/** Таблица дизайн-системы: заголовки caption, строки через тонкую линию, подсветка по наведению. */
export function Table<Row>({
  columns,
  rows,
  rowKey,
  dense = false,
  rowClassName,
  className,
}: {
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  dense?: boolean;
  rowClassName?: (row: Row) => string | undefined;
  className?: string;
}) {
  return (
    <div className={cx(styles.tableWrap, className)}>
      <table className={cx(styles.table, dense && styles.dense)}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width, textAlign: column.align ?? 'left' }}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className={rowClassName?.(row)}>
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Официальный логотип Билайна (public/brand/beeline_logo.svg) и название продукта. */
export function Logo({
  size = 36,
  wordmark = true,
  product = 'Маршруты инженеров',
}: {
  size?: number;
  wordmark?: boolean;
  product?: string | null;
}) {
  return (
    <span className={styles.logo}>
      <img src="/brand/beeline_logo.svg" width={size} height={size} alt="Билайн" />
      {wordmark && (
        <span className={styles.wordmark}>
          <span className={styles.brand}>Билайн Бизнес</span>
          {product && <span className={styles.product}>{product}</span>}
        </span>
      )}
    </span>
  );
}

export function Spinner({ size = 20, label = 'Загрузка' }: { size?: number; label?: string }) {
  return (
    <span role="status" aria-label={label} className={styles.spinnerWrap}>
      <LoaderCircle size={size} className={styles.spinner} aria-hidden />
    </span>
  );
}
