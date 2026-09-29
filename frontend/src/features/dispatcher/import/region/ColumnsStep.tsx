import { CONTROL_FIELDS, groupNotes, REQUEST_FIELDS, ROSTER_FIELDS } from '@/adapters/columnMap';
import { DELIMITER_LABEL, ENCODING_LABEL, type CsvTable } from '@/adapters/csvTable';
import { countOf, formatInt, plural, PL_BRIGADE, PL_REQUEST, PL_ROW } from '@/lib/format';
import { Callout } from '@/ui';
import { MappingTable } from './MappingTable';
import type { RegionDraft } from './useRegionDraft';
import styles from './RegionWizard.module.css';

const tableMeta = (table: CsvTable) =>
  `${ENCODING_LABEL[table.encoding]} · разделитель ${DELIMITER_LABEL[table.delimiter]} · ${countOf(table.rows.length, PL_ROW)}`;

/** «строки 3, 7, 12» — не больше восьми номеров. */
function linesText(lines: readonly number[]): string {
  const shown = lines.slice(0, 8).join(', ');
  const more = lines.length > 8 ? ` и ещё ${formatInt(lines.length - 8)}` : '';
  return `${lines.length === 1 ? 'строка' : 'строки'} ${shown}${more}`;
}

function Errors({ errors }: { errors: readonly string[] }) {
  if (errors.length === 0) return null;
  return (
    <Callout tone="danger">
      {errors.length === 1 ? (
        errors[0]
      ) : (
        <ul className={styles.list}>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}

/** Оговорки по строкам файла: одна — строкой, несколько — списком. */
function RowNotes({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <Callout tone="warning">
      {items.length === 1 ? (
        items[0]
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}

function SectionHead({ title, table }: { title: string; table: CsvTable }) {
  return (
    <div className={styles.sectionHead}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <span className={styles.sectionNote}>{tableMeta(table)}</span>
    </div>
  );
}

/**
 * Шаг 2: какая колонка файла — какое поле заявки, контрольного распределения и бригад. Сверху —
 * зачем шаг и итог (всё ли нашли), у каждого поля — зачем оно; оговорки по строкам — под таблицей.
 */
export function ColumnsStep({ draft, disabled }: { draft: RegionDraft; disabled: boolean }) {
  const requests = draft.files.requests?.table;
  const control = draft.files.control?.table;
  const roster = draft.files.roster?.table;
  const { read, controlRead } = draft;
  const skipped = read ? groupNotes(read.skipped) : [];
  const notes = read ? groupNotes(read.notes) : [];

  return (
    <div className={styles.stack}>
      <p className={styles.text}>
        Сверяем ваш файл с полями заявки. Колонки мы узнали по названиям — проверьте их по первому
        значению справа. Если поле попало не в ту колонку или колонку не нашли, выберите её в
        списке.
      </p>

      {requests && draft.requestMap && (
        <section className={styles.section} aria-label="Файл заявок">
          <SectionHead title="Файл заявок" table={requests} />
          <Errors errors={draft.requestErrors} />
          {draft.requestErrors.length === 0 && read && (
            <Callout tone={read.rows.length > 0 ? 'success' : 'danger'}>
              {read.rows.length > 0
                ? `Нужные колонки нашли — загрузим ${countOf(read.rows.length, PL_REQUEST)}`
                : 'Ни одной заявки: ни в одной строке нет адреса'}
            </Callout>
          )}
          <MappingTable
            fields={REQUEST_FIELDS}
            mapping={draft.requestMap}
            table={requests}
            disabled={disabled}
            onChange={draft.setRequestMap}
          />
          {draft.requestErrors.length === 0 && (
            <RowNotes
              items={[
                ...skipped.map(({ text, lines }) => `Не загрузим — ${text}: ${linesText(lines)}`),
                ...notes.map(
                  ({ text, lines }) =>
                    `${text[0].toUpperCase()}${text.slice(1)}: ${linesText(lines)}`,
                ),
              ]}
            />
          )}
        </section>
      )}

      {control && draft.controlMap && (
        <section className={styles.section} aria-label="Контрольное распределение">
          <SectionHead title="Контрольное распределение" table={control} />
          <p className={styles.text}>
            Из него берём только бригаду у каждой заявки: по ней соберём состав бригад и сравним
            план с реальным диспетчером.
          </p>
          {typeof controlRead === 'string' && <Errors errors={[controlRead]} />}
          {controlRead && typeof controlRead !== 'string' && read && (
            <Callout tone={controlRead.matched === read.rows.length ? 'success' : 'warning'}>
              Бригада есть у {formatInt(controlRead.matched)} из {formatInt(read.rows.length)}{' '}
              {plural(read.rows.length, ['заявки', 'заявок', 'заявок'])}:{' '}
              {controlRead.by === 'id'
                ? 'сопоставили по номеру заявки'
                : 'сопоставили по порядку строк'}
            </Callout>
          )}
          <MappingTable
            fields={CONTROL_FIELDS}
            mapping={draft.controlMap}
            table={control}
            disabled={disabled}
            onChange={draft.setControlMap}
          />
        </section>
      )}

      {roster && draft.rosterMap && (
        <section className={styles.section} aria-label="Файл бригад">
          <SectionHead title="Бригады" table={roster} />
          <p className={styles.text}>Имена, навыки, транспорт и смены бригад участка.</p>
          <Errors errors={draft.rosterErrors} />
          {draft.rosterErrors.length === 0 && (
            <Callout tone={draft.rosterFileRows.length > 0 ? 'success' : 'danger'}>
              {draft.rosterFileRows.length > 0
                ? `В файле ${countOf(draft.rosterFileRows.length, PL_BRIGADE)}`
                : 'В файле нет ни одной бригады с именем'}
            </Callout>
          )}
          <MappingTable
            fields={ROSTER_FIELDS}
            mapping={draft.rosterMap}
            table={roster}
            disabled={disabled}
            onChange={draft.setRosterMap}
          />
        </section>
      )}
    </div>
  );
}
