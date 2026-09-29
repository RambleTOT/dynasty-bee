import { FilePlus2, Upload, Users } from 'lucide-react';
import { formatFileSize } from '@/lib/csv';
import { countOf, formatDayMonth, PL_ROW } from '@/lib/format';
import { Callout, Input } from '@/ui';
import { AddressInput } from '@/features/shared/AddressInput';
import type { DayConflict } from '../dayConflict';
import { FileDrop } from '../FileDrop';
import type { FileSlot, PickedTable, RegionDraft } from './useRegionDraft';
import styles from './RegionWizard.module.css';

function fileMeta(picked: PickedTable): string {
  if (picked.error) return picked.error;
  if (!picked.table) return formatFileSize(picked.file.size);
  return `${countOf(picked.table.rows.length, PL_ROW)} · ${formatFileSize(picked.file.size)}`;
}

const DROPS: { slot: FileSlot; label: string; hint: string; icon: typeof Upload }[] = [
  {
    slot: 'requests',
    label: 'Файл заявок (.csv)',
    hint: 'Перетащите файл или выберите',
    icon: Upload,
  },
  {
    slot: 'control',
    label: 'Контрольное распределение — по желанию',
    hint: 'Бригады реального диспетчера: для состава и сравнения',
    icon: FilePlus2,
  },
  {
    slot: 'roster',
    label: 'Бригады — по желанию',
    hint: 'Имена, навыки, транспорт, смена',
    icon: Users,
  },
];

/** Шаг 1: название участка, офис и файлы. */
export function FilesStep({
  draft,
  date,
  conflict,
  showErrors,
  disabled,
}: {
  draft: RegionDraft;
  date: string;
  conflict: DayConflict | null;
  showErrors: boolean;
  disabled: boolean;
}) {
  const { officeLookup } = draft;
  const officeHint = draft.officePick
    ? 'Точка офиса выбрана'
    : officeLookup.isFetching
      ? 'Ищем точку офиса…'
      : officeLookup.data
        ? `Точка по адресу: ${officeLookup.data.label}`
        : 'Бригады выезжают из офиса: от него считаем дорогу';
  const officeError =
    showErrors && !draft.officePoint
      ? draft.officeAddress.trim()
        ? 'Точку офиса не нашли — выберите адрес из подсказок или укажите на карте'
        : 'Введите адрес офиса'
      : undefined;

  return (
    <div className={styles.stack}>
      <Callout tone="info">
        Файл участка не из списка: свой офис, бригады и нормативы. Колонки сопоставим на следующем
        шаге — подойдёт CSV в UTF-8 или Windows-1251 с разделителем «;», «,» или табуляцией.
      </Callout>
      <div className={styles.fields}>
        <Input
          label="Название участка"
          value={draft.name}
          required
          maxLength={60}
          disabled={disabled}
          placeholder="Например, Север"
          error={showErrors ? (draft.nameError ?? undefined) : undefined}
          onChange={(event) => draft.setName(event.target.value)}
        />
        <AddressInput
          label="Адрес офиса"
          value={draft.officeAddress}
          point={draft.officePoint}
          hint={officeError ? undefined : officeHint}
          error={officeError}
          onChange={draft.setOfficeAddress}
          onPick={(suggestion) => {
            draft.setOfficeAddress(suggestion.value);
            draft.setOfficePick({ lat: suggestion.lat, lon: suggestion.lon });
          }}
        />
      </div>

      {conflict === 'replace' && (
        <Callout tone="warning">
          На {formatDayMonth(date)} у участка уже загружен CSV. Новый файл заменит его: прежние
          заявки, план и события дня уйдут в архив
        </Callout>
      )}
      {conflict === 'blocked' && (
        <Callout tone="danger">
          На {formatDayMonth(date)} у участка уже есть записи оператора — CSV на этот день бэк не
          примет. Выберите другую дату
        </Callout>
      )}

      <section className={styles.section} aria-label="Файлы участка">
        <div className={styles.files}>
          {DROPS.map(({ slot, label, hint, icon }) => {
            const picked = draft.files[slot];
            return (
              <FileDrop
                key={slot}
                label={label}
                hint={hint}
                icon={icon}
                inputLabel={label}
                picked={picked && { name: picked.file.name, meta: fileMeta(picked) }}
                disabled={disabled}
                onPick={(file) => draft.pickFile(slot, file)}
                onClear={() => draft.pickFile(slot, null)}
              />
            );
          })}
        </div>
        {showErrors && !draft.files.requests && (
          <Callout tone="danger">Выберите файл заявок</Callout>
        )}
        {(['requests', 'control', 'roster'] as const).map((slot) => {
          const error = draft.files[slot]?.error;
          return error ? (
            <Callout key={slot} tone="danger">
              {draft.files[slot]?.file.name}: {error}
            </Callout>
          ) : null;
        })}
      </section>
    </div>
  );
}
