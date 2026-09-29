import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { FieldDef, Mapping } from '@/adapters/columnMap';
import type { CsvTable } from '@/adapters/csvTable';
import { plural } from '@/lib/format';
import { Button, Select, type SelectOption } from '@/ui';
import styles from './RegionWizard.module.css';

const NONE = '';

/** Первое непустое значение колонки — по нему видно, та ли это колонка. */
function sampleOf(table: CsvTable, column: number | null): string {
  if (column === null) return '';
  return table.rows.find((row) => (row[column] ?? '').trim())?.[column]?.trim() ?? '';
}

/**
 * Поле заявки → колонка файла, с первым значением из неё. Необязательные поля без колонки свёрнуты
 * («если есть в файле»); под таблицей — колонки файла, которые не загружаем.
 */
export function MappingTable<F extends string>({
  fields,
  mapping,
  table,
  onChange,
  disabled = false,
}: {
  fields: readonly FieldDef<F>[];
  mapping: Mapping<F>;
  table: CsvTable;
  onChange: (next: Mapping<F>) => void;
  disabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const options: SelectOption[] = [
    { value: NONE, label: '— нет колонки —' },
    ...table.header.map((name, index) => ({
      value: String(index),
      label: name || `Колонка ${index + 1}`,
    })),
  ];
  const hidden = showAll
    ? []
    : fields.filter((field) => field.extra && mapping[field.key] === null);
  const shown = fields.filter((field) => !hidden.includes(field));
  const used = new Set(Object.values<number | null>(mapping));
  const unused = table.header.filter((name, index) => name && !used.has(index));

  return (
    <>
      <div className={styles.mapping} role="group" aria-label="Колонки файла">
        <span className={styles.mappingHead}>Что нужно</span>
        <span className={styles.mappingHead}>Колонка в вашем файле</span>
        <span className={styles.mappingHead}>Первое значение</span>
        {shown.map((field) => {
          const column = mapping[field.key];
          return (
            <FieldRow
              key={field.key}
              field={field}
              value={column === null ? NONE : String(column)}
              sample={sampleOf(table, column)}
              options={options}
              disabled={disabled}
              onChange={(value) =>
                onChange({ ...mapping, [field.key]: value === NONE ? null : Number(value) })
              }
            />
          );
        })}
      </div>
      {hidden.length > 0 && (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronDown}
            title={hidden.map((field) => field.label).join(', ')}
            onClick={() => setShowAll(true)}
          >
            Ещё {hidden.length} {plural(hidden.length, ['поле', 'поля', 'полей'])} — если они есть в
            файле
          </Button>
        </div>
      )}
      {unused.length > 0 && (
        <span className={styles.sectionNote}>
          Не загружаем {plural(unused.length, ['колонку', 'колонки', 'колонок'])} файла:{' '}
          {unused.map((name) => `«${name}»`).join(', ')}
        </span>
      )}
    </>
  );
}

function FieldRow<F extends string>({
  field,
  value,
  sample,
  options,
  disabled,
  onChange,
}: {
  field: FieldDef<F>;
  value: string;
  sample: string;
  options: SelectOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <span className={styles.fieldLabel}>
        <span>
          {field.label}
          {field.required && (
            <span className={styles.required} aria-hidden>
              {' '}
              *
            </span>
          )}
        </span>
        {field.hint && <span className={styles.fieldHint}>{field.hint}</span>}
      </span>
      <Select
        size="sm"
        tone="white"
        aria-label={field.label}
        options={options}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      <span className={styles.sample} title={sample}>
        {sample || '—'}
      </span>
    </>
  );
}
