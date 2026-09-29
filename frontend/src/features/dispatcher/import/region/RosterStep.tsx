import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  emptyRosterRow,
  ROSTER_SOURCE_LABEL,
  type RosterRow,
  type RosterSource,
} from '@/adapters/regionRoster';
import { SKILL_SHORT, TRANSPORT_SHORT } from '@/lib/dictionaries';
import { SKILL_LABEL, SKILLS, TRANSPORTS, type Transport } from '@/lib/statuses';
import {
  Button,
  Callout,
  Checkbox,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Table,
  type TableColumn,
} from '@/ui';
import type { RegionDraft } from './useRegionDraft';
import styles from './RegionWizard.module.css';

const SOURCE_SHORT: Record<RosterSource, string> = {
  control: 'Контрольный файл',
  file: 'Файл бригад',
  saved: 'Сохранённые',
  rule: 'По правилу',
};

const SOURCE_HINT: Record<RosterSource, string> = {
  control:
    'Имена — из колонки «Бригада», навыки — по заявкам, которые бригаде дал реальный диспетчер. Имена не меняйте: по ним сравниваем план с реальным диспетчером',
  file: 'Бригады из файла: имя, навыки, транспорт и смена — по колонкам, которые вы выбрали',
  saved: 'Бригады, сохранённые у участка при прошлой загрузке',
  rule: 'Бригада на 5–6 заявок, не меньше трёх; «Аварийные работы» — у каждой четвёртой. Поправьте состав под участок',
};

const TRANSPORT_OPTIONS = TRANSPORTS.map((transport) => ({
  value: transport,
  label: TRANSPORT_SHORT[transport],
}));

/** Шаг 4: состав бригад участка — откуда взять и правка по строкам. */
export function RosterStep({ draft, disabled }: { draft: RegionDraft; disabled: boolean }) {
  const rows = draft.roster ?? [];
  const source = draft.rosterSource;
  const [shiftStart, setShiftStart] = useState(draft.shift.start);
  const [shiftEnd, setShiftEnd] = useState(draft.shift.end);
  const shiftOk = Boolean(shiftStart && shiftEnd && shiftStart < shiftEnd);

  const update = (key: string, patch: Partial<RosterRow>) =>
    draft.setRoster((prev) =>
      (prev ?? []).map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const columns: TableColumn<RosterRow>[] = [
    {
      key: 'name',
      title: 'Бригада',
      render: (row) => (
        <div className={styles.nameCell}>
          <Input
            size="sm"
            aria-label="Имя бригады"
            value={row.name}
            disabled={disabled}
            onChange={(event) => update(row.key, { name: event.target.value })}
          />
          <span className={styles.shiftCaption}>
            Смена {row.shiftStart}–{row.shiftEnd}
          </span>
        </div>
      ),
    },
    {
      key: 'skills',
      title: 'Навыки',
      width: 262,
      render: (row) => (
        <div className={styles.skills} role="group" aria-label={`Навыки · ${row.name}`}>
          {SKILLS.map((skill) => (
            <span key={skill} title={SKILL_LABEL[skill]}>
              <Checkbox
                label={SKILL_SHORT[skill]}
                checked={row.skills.includes(skill)}
                disabled={disabled}
                onChange={(on) =>
                  update(row.key, {
                    skills: SKILLS.filter((item) =>
                      item === skill ? on : row.skills.includes(item),
                    ),
                  })
                }
              />
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'transport',
      title: 'Транспорт',
      width: 164,
      render: (row) => (
        <Select
          size="sm"
          aria-label={`Транспорт · ${row.name}`}
          options={TRANSPORT_OPTIONS}
          value={row.transport}
          disabled={disabled}
          onChange={(value) => update(row.key, { transport: value as Transport })}
        />
      ),
    },
    {
      key: 'remove',
      title: '',
      width: 52,
      render: (row) => (
        <IconButton
          icon={Trash2}
          variant="ghost"
          size="sm"
          label={`Убрать ${row.name || 'бригаду'}`}
          disabled={disabled}
          onClick={() =>
            draft.setRoster((prev) => (prev ?? []).filter((item) => item.key !== row.key))
          }
        />
      ),
    },
  ];

  return (
    <div className={styles.stack}>
      <SegmentedControl<RosterSource>
        label="Откуда состав"
        size="sm"
        options={(['control', 'file', 'saved', 'rule'] as const).map((option) => ({
          value: option,
          label: SOURCE_SHORT[option],
          count: draft.rosterSources.includes(option) ? draft.rosterSourceCounts[option] : null,
          disabled: disabled || !draft.rosterSources.includes(option),
        }))}
        value={source ?? 'rule'}
        onChange={draft.chooseRosterSource}
      />
      {source && <p className={styles.text}>{SOURCE_HINT[source]}</p>}

      <div className={styles.shift}>
        <Input
          label="Смена с"
          size="sm"
          tone="white"
          type="time"
          fieldClassName={styles.time}
          value={shiftStart}
          disabled={disabled}
          onChange={(event) => setShiftStart(event.target.value)}
        />
        <Input
          label="до"
          size="sm"
          tone="white"
          type="time"
          fieldClassName={styles.time}
          value={shiftEnd}
          disabled={disabled}
          onChange={(event) => setShiftEnd(event.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !shiftOk}
          onClick={() =>
            draft.setRoster((prev) => (prev ?? []).map((row) => ({ ...row, shiftStart, shiftEnd })))
          }
        >
          Всем бригадам
        </Button>
      </div>

      <Table
        className={styles.table}
        dense
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
      />
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          disabled={disabled}
          onClick={() =>
            draft.setRoster((prev) => [
              ...(prev ?? []),
              emptyRosterRow(
                {
                  start: shiftOk ? shiftStart : draft.shift.start,
                  end: shiftOk ? shiftEnd : draft.shift.end,
                },
                `Бригада ${(prev?.length ?? 0) + 1}`,
              ),
            ])
          }
        >
          Добавить бригаду
        </Button>
        <span className={styles.footerNote}>
          {ROSTER_SOURCE_LABEL[source ?? 'rule']}: {rows.length}
        </span>
      </div>

      {draft.rosterCheck.errors.length > 0 && (
        <Callout tone="danger">
          <ul className={styles.list}>
            {draft.rosterCheck.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Callout>
      )}
      {draft.rosterCheck.warnings.length > 0 && (
        <Callout tone="warning">
          <ul className={styles.list}>
            {draft.rosterCheck.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}
