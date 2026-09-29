import { DURATION_MAX, DURATION_MIN } from '@/adapters/columnMap';
import { normError, type NormRow, type NormSource } from '@/adapters/regionNorms';
import { formatInt, plural } from '@/lib/format';
import { SKILL_LABEL, SKILLS, type Skill } from '@/lib/statuses';
import { Callout, Input, Select, Table, ToneChip, type TableColumn } from '@/ui';
import type { RegionDraft } from './useRegionDraft';
import styles from './RegionWizard.module.css';

const SOURCE_CHIP: Record<NormSource, { tone: 'neutral' | 'info' | 'warning'; text: string }> = {
  saved: { tone: 'neutral', text: 'норматив участка' },
  beeline: { tone: 'info', text: 'как у Билайна' },
  guess: { tone: 'warning', text: 'новый тип' },
  edited: { tone: 'neutral', text: 'изменён' },
};

const SKILL_OPTIONS = SKILLS.map((skill) => ({ value: skill, label: SKILL_LABEL[skill] }));

/** Шаг 3: навык и длительность работы по каждому типу заявки из файла. */
export function NormsStep({ draft, disabled }: { draft: RegionDraft; disabled: boolean }) {
  const rows = draft.norms ?? [];
  const fromFile = draft.read?.rows.filter((row) => row.duration !== null).length ?? 0;
  const guessed = rows.filter((row) => row.source === 'guess').length;

  const update = (typeBk: string, patch: Pick<Partial<NormRow>, 'skill' | 'duration'>) =>
    draft.setNorms((prev) =>
      (prev ?? []).map((row) =>
        row.typeBk === typeBk ? { ...row, ...patch, source: 'edited' } : row,
      ),
    );

  const columns: TableColumn<NormRow>[] = [
    {
      key: 'type',
      title: 'Тип заявки',
      render: (row) => row.typeBk || <span className={styles.muted}>без типа</span>,
    },
    {
      key: 'count',
      title: 'Заявок',
      align: 'right',
      width: 72,
      render: (row) => formatInt(row.count),
    },
    {
      key: 'skill',
      title: 'Навык бригады',
      width: 276,
      render: (row) => (
        <Select
          size="sm"
          aria-label={`Навык · ${row.typeBk || 'без типа'}`}
          options={SKILL_OPTIONS}
          value={row.skill}
          disabled={disabled}
          onChange={(value) => update(row.typeBk, { skill: value as Skill })}
        />
      ),
    },
    {
      key: 'duration',
      title: 'Минут',
      width: 104,
      render: (row) => (
        <Input
          size="sm"
          type="number"
          inputMode="numeric"
          min={DURATION_MIN}
          max={DURATION_MAX}
          aria-label={`Минут · ${row.typeBk || 'без типа'}`}
          className={styles.number}
          value={row.duration ?? ''}
          disabled={disabled}
          error={normError(row) ?? undefined}
          onChange={(event) => {
            const value = event.target.value.trim();
            update(row.typeBk, { duration: value === '' ? null : Math.round(Number(value)) });
          }}
        />
      ),
    },
    {
      key: 'source',
      title: '',
      width: 132,
      render: (row) => (
        <ToneChip size="sm" tone={SOURCE_CHIP[row.source].tone}>
          {SOURCE_CHIP[row.source].text}
        </ToneChip>
      ),
    },
  ];

  return (
    <div className={styles.stack}>
      <p className={styles.text}>
        Норматив — работа на адресе без дороги. Навык решает, какая бригада может взять заявку.
        Нормативы сохранятся у участка: по ним же оператор будет записывать клиентов.
      </p>
      {guessed > 0 && (
        <Callout tone="warning">
          Типов нет в нормативах Билайна: {formatInt(guessed)}. Навык угадали по названию —
          проверьте его и минуты
        </Callout>
      )}
      {fromFile > 0 && (
        <Callout tone="info">
          У {formatInt(fromFile)} {plural(fromFile, ['заявки', 'заявок', 'заявок'])} длительность
          есть в файле — она важнее норматива
        </Callout>
      )}
      <Table
        className={styles.table}
        dense
        columns={columns}
        rows={rows}
        rowKey={(row) => row.typeBk || '—'}
      />
    </div>
  );
}
