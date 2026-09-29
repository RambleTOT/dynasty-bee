import { Check, MapPinned, Search } from 'lucide-react';
import { useState } from 'react';
import { addressSuggestEnabled } from '@/api/geocoder';
import { countOf, formatInt, plural, PL_REQUEST } from '@/lib/format';
import { Button, Callout } from '@/ui';
import { AddressMapModal } from '@/features/shared/AddressMapModal';
import type { RegionDraft } from './useRegionDraft';
import styles from './RegionWizard.module.css';

const SHOWN = 8;

/**
 * Шаг 5: точки заявок. Координаты из файла — как есть; остальные адреса диспетчер кнопкой ищет в
 * Photon (адреса уходят в сторонний сервис), не найденные ставит на карте или оставляет бэку.
 */
export function PointsStep({ draft, disabled }: { draft: RegionDraft; disabled: boolean }) {
  const rows = draft.read?.rows ?? [];
  const toFind = rows.filter((row) => row.lat === null || row.lon === null);
  const fromFile = rows.length - toFind.length;
  const { progress, hits, missed } = draft.geocode;
  const [placing, setPlacing] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const exact = [...hits.values()].filter((hit) => hit.precision === 'house').length;
  const missedRows = missed.flatMap((source) => rows.filter((row) => row.source === source));
  const placed = missedRows.filter((row) => draft.manualPoints.has(row.source)).length;
  const withPoint = draft.points.size;
  const run = () =>
    void draft.geocode.run(
      toFind.map((row) => ({ source: row.source, address: row.address })),
      draft.officePoint,
    );

  return (
    <div className={styles.stack}>
      <p className={styles.text}>
        Бригады едут от офиса по точкам заявок: без точек план не посчитать.
        {fromFile > 0 &&
          ` Координаты из файла — у ${formatInt(fromFile)} ${plural(fromFile, ['заявки', 'заявок', 'заявок'])}.`}
      </p>

      {toFind.length === 0 && (
        <Callout tone="success">У всех заявок есть координаты из файла</Callout>
      )}

      {toFind.length > 0 && !addressSuggestEnabled && (
        <Callout tone="info">
          Поиск адресов выключен: точки {formatInt(toFind.length)}{' '}
          {plural(toFind.length, ['заявки', 'заявок', 'заявок'])} найдёт бэк, а не найденные
          поставит у офиса
        </Callout>
      )}

      {toFind.length > 0 && addressSuggestEnabled && !progress.finished && !progress.running && (
        <Callout tone="warning">
          Без поиска {formatInt(toFind.length)}{' '}
          {plural(toFind.length, ['заявка встанет', 'заявки встанут', 'заявок встанут'])} у офиса,
          если их не найдёт геокодер бэка, — маршрут по ним не посчитать. Нажмите «Найти точки»
        </Callout>
      )}

      {toFind.length > 0 && addressSuggestEnabled && (
        <section className={styles.section} aria-label="Поиск точек по адресам">
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Найти точки по адресам</h3>
            <span className={styles.sectionNote}>
              {countOf(toFind.length, PL_REQUEST)} без координат
            </span>
          </div>
          <p className={styles.text}>
            Ищем в OpenStreetMap через сервис Photon — адреса заявок уйдут в этот сервис. Не нужно —
            пропустите шаг: точки найдёт бэк, а не найденные поставит у офиса.
          </p>
          {progress.running && (
            <>
              <div
                className={styles.progress}
                role="progressbar"
                aria-label="Поиск адресов"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <div
                  className={styles.progressBar}
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <span className={styles.sectionNote}>
                Ищем: {formatInt(progress.done)} из {formatInt(progress.total)}
              </span>
            </>
          )}
          {progress.finished && (
            <Callout tone={missed.length > 0 ? 'warning' : 'success'}>
              Нашли {formatInt(hits.size)} из {formatInt(toFind.length)}: у {formatInt(exact)} —
              дом, у {formatInt(hits.size - exact)} — только улица
              {missed.length > 0 &&
                `. Не нашли ${formatInt(missed.length)} — укажите на карте или оставьте бэку`}
            </Callout>
          )}
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              icon={Search}
              loading={progress.running}
              disabled={disabled || progress.running}
              onClick={run}
            >
              {progress.finished ? 'Найти заново' : 'Найти точки'}
            </Button>
          </div>
        </section>
      )}

      {missedRows.length > 0 && (
        <section className={styles.section} aria-label="Адреса без точки">
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>Не нашли</h3>
            <span className={styles.sectionNote}>
              на карте — {formatInt(placed)} из {formatInt(missedRows.length)}
            </span>
          </div>
          <ul className={styles.missed}>
            {(showAll ? missedRows : missedRows.slice(0, SHOWN)).map((row) => {
              const done = draft.manualPoints.has(row.source);
              return (
                <li key={row.source} className={styles.missedRow}>
                  <div className={styles.missedText}>
                    {row.address}
                    <div className={styles.missedLine}>
                      №{row.id} · строка {row.line}
                    </div>
                  </div>
                  {done && (
                    <span className={styles.placed}>
                      <Check size={14} aria-hidden />
                      на карте
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={MapPinned}
                    disabled={disabled}
                    onClick={() => setPlacing(row.source)}
                  >
                    {done ? 'Поправить' : 'Указать на карте'}
                  </Button>
                </li>
              );
            })}
          </ul>
          {missedRows.length > SHOWN && !showAll && (
            <div className={styles.actions}>
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                Показать все {formatInt(missedRows.length)}
              </Button>
            </div>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <span className={styles.sectionNote}>
          С точкой — {formatInt(withPoint)} из {formatInt(rows.length)}
          {withPoint < rows.length &&
            `; без точки — ${formatInt(rows.length - withPoint)}: их найдёт геокодер бэка или поставит у офиса`}
        </span>
      )}

      {placing !== null && (
        <AddressMapModal
          initial={draft.manualPoints.get(placing) ?? draft.officePoint}
          onPick={(suggestion) => {
            draft.setManualPoint(placing, { lat: suggestion.lat, lon: suggestion.lon });
            setPlacing(null);
          }}
          onClose={() => setPlacing(null)}
        />
      )}
    </div>
  );
}
