import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { geocodeHit, geocodeQuery } from '@/adapters/address';
import { controlCsv, requestsCsv, type Point } from '@/adapters/canonicalCsv';
import {
  CONTROL_FIELDS,
  guessMapping,
  mappingErrors,
  readControl,
  readRequests,
  REQUEST_FIELDS,
  requestMappingErrors,
  ROSTER_FIELDS,
  type ControlField,
  type Mapping,
  type RequestField,
  type RosterField,
} from '@/adapters/columnMap';
import { readCsvTable, type CsvTable } from '@/adapters/csvTable';
import {
  normError,
  normKey,
  normLookup,
  normRows,
  toRegionNorms,
  type NormRow,
} from '@/adapters/regionNorms';
import {
  checkRoster,
  rosterByRule,
  rosterFromControl,
  rosterFromFile,
  rosterFromSaved,
  ROSTER_SOURCE_LABEL,
  shiftOf,
  toRosterEngineers,
  type RosterRow,
  type RosterSource,
} from '@/adapters/regionRoster';
import { addressSuggestEnabled, geocodeAddress } from '@/api/geocoder';
import { queryKeys } from '@/api/queryKeys';
import { getRegionRoster } from '@/api/regions';
import type { RegionItem } from '@/hooks/useRegions';
import type { Skill } from '@/lib/statuses';
import type { RegionUpload } from './uploadRegion';
import { useGeocodeBatch } from './useGeocodeBatch';

export type WizardStep = 'files' | 'columns' | 'norms' | 'roster' | 'points';
export const STEPS: readonly WizardStep[] = ['files', 'columns', 'norms', 'roster', 'points'];
export const STEP_TITLE: Record<WizardStep, string> = {
  files: 'участок и файлы',
  columns: 'колонки файла',
  norms: 'нормативы',
  roster: 'бригады',
  points: 'точки заявок',
};

export type FileSlot = 'requests' | 'control' | 'roster';

export interface PickedTable {
  file: File;
  /** `null` — ещё читаем или не прочитали. */
  table: CsvTable | null;
  error: string | null;
}

const NAME_MAX = 60;

/** Одинаковые названия участков не различить в списках: «Север» и «север » — один участок. */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Черновик загрузки своего участка (§14): файлы, сопоставление колонок, нормативы, бригады, точки.
 * Шаги читают из него готовые данные; «Загрузить» собирает из него `RegionUpload`.
 */
export function useRegionDraft(region: RegionItem | null, regions: readonly RegionItem[]) {
  const info = region?.info ?? null;
  const [name, setName] = useState(region?.name ?? '');
  const [officeAddress, setOfficeAddressText] = useState(info?.office.address ?? '');
  const [officePick, setOfficePick] = useState<Point | null>(
    info ? { lat: info.office.lat, lon: info.office.lon } : null,
  );
  const [files, setFiles] = useState<Record<FileSlot, PickedTable | null>>({
    requests: null,
    control: null,
    roster: null,
  });
  const [requestMap, setRequestMap] = useState<Mapping<RequestField> | null>(null);
  const [controlMap, setControlMap] = useState<Mapping<ControlField> | null>(null);
  const [rosterMap, setRosterMap] = useState<Mapping<RosterField> | null>(null);
  const [norms, setNorms] = useState<NormRow[] | null>(null);
  const [rosterSource, setRosterSource] = useState<RosterSource | null>(null);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [manualPoints, setManualPoints] = useState<ReadonlyMap<number, Point>>(new Map());
  const geocode = useGeocodeBatch();

  const saved = useQuery({
    queryKey: queryKeys.regionRoster(region?.id ?? ''),
    queryFn: ({ signal }) => getRegionRoster(region?.id ?? '', signal),
    enabled: region !== null && !region.builtin,
    staleTime: 60_000,
  });

  // --- участок и офис ---

  const nameError = (() => {
    const trimmed = name.trim();
    if (!trimmed) return 'Введите название';
    if (trimmed.length > NAME_MAX) return `Не длиннее ${NAME_MAX} символов`;
    const taken = regions.find((item) => item.id !== region?.id && sameName(item.name, trimmed));
    return taken ? `Участок «${taken.name}» уже есть — выберите его в списке` : null;
  })();

  const setOfficeAddress = useCallback((text: string) => {
    setOfficeAddressText(text);
    setOfficePick(null);
  }, []);
  // адрес офиса из файла подставляем, только если поле пустое на момент, когда файл прочитан
  const officeAddressRef = useRef(officeAddress);
  officeAddressRef.current = officeAddress;

  // Точка офиса: выбрана подсказкой или на карте; иначе ищем по введённому адресу.
  const officeQuery = geocodeQuery(officeAddress);
  const officeLookup = useQuery({
    queryKey: ['address', 'geocode', officeQuery],
    queryFn: async ({ signal }) =>
      geocodeHit(await geocodeAddress(officeQuery, null, signal), officeQuery, null),
    enabled: addressSuggestEnabled && officePick === null && officeQuery.length >= 5,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const officePoint: Point | null =
    officePick ??
    (officeLookup.data ? { lat: officeLookup.data.lat, lon: officeLookup.data.lon } : null);

  // --- файлы ---

  const resetGeocode = geocode.reset;
  const resetPlan = useCallback(() => {
    setNorms(null);
    setRoster(null);
    setRosterSource(null);
    setManualPoints(new Map());
    resetGeocode();
  }, [resetGeocode]);

  const pickFile = useCallback(
    (slot: FileSlot, file: File | null) => {
      setFiles((prev) => ({ ...prev, [slot]: file && { file, table: null, error: null } }));
      if (slot === 'requests') {
        setRequestMap(null);
        resetPlan();
      } else {
        if (slot === 'control') setControlMap(null);
        else setRosterMap(null);
        setRoster(null);
        setRosterSource(null);
      }
      if (!file) return;
      readCsvTable(file).then(
        (table) => {
          const error = table.header.length < 2 ? 'Не нашли колонок: проверьте разделитель' : null;
          setFiles((prev) =>
            prev[slot]?.file === file ? { ...prev, [slot]: { file, table, error } } : prev,
          );
          if (slot === 'requests') {
            setRequestMap(guessMapping(REQUEST_FIELDS, table.header));
            if (table.officeAddress && !officeAddressRef.current.trim())
              setOfficeAddress(table.officeAddress);
          } else if (slot === 'control') setControlMap(guessMapping(CONTROL_FIELDS, table.header));
          else setRosterMap(guessMapping(ROSTER_FIELDS, table.header));
        },
        () =>
          setFiles((prev) =>
            prev[slot]?.file === file
              ? { ...prev, [slot]: { file, table: null, error: 'Не удалось прочитать файл' } }
              : prev,
          ),
      );
    },
    [resetPlan, setOfficeAddress],
  );

  const updateRequestMap = useCallback(
    (next: Mapping<RequestField>) => {
      setRequestMap(next);
      resetPlan();
    },
    [resetPlan],
  );

  const updateControlMap = useCallback((next: Mapping<ControlField>) => {
    setControlMap(next);
    setRoster(null);
    setRosterSource(null);
  }, []);

  const updateRosterMap = useCallback((next: Mapping<RosterField>) => {
    setRosterMap(next);
    setRoster(null);
    setRosterSource(null);
  }, []);

  // --- разбор ---

  const requestsTable = files.requests?.table ?? null;
  const read = useMemo(
    () => (requestsTable && requestMap ? readRequests(requestsTable, requestMap) : null),
    [requestsTable, requestMap],
  );
  const requestErrors =
    requestsTable && requestMap ? requestMappingErrors(requestMap, requestsTable.header) : [];

  const controlTable = files.control?.table ?? null;
  const controlRead = useMemo(
    () =>
      controlTable && controlMap && requestsTable && read
        ? readControl(controlTable, controlMap, requestsTable, read.rows)
        : null,
    [controlTable, controlMap, requestsTable, read],
  );

  const rosterTable = files.roster?.table ?? null;
  const rosterErrors =
    rosterTable && rosterMap ? mappingErrors(ROSTER_FIELDS, rosterMap, rosterTable.header) : [];
  const shift = useMemo(() => shiftOf(read?.rows ?? []), [read]);
  const rosterFileRows = useMemo(
    () =>
      rosterTable && rosterMap && rosterErrors.length === 0
        ? rosterFromFile(rosterTable, rosterMap, shift)
        : [],
    // rosterErrors — производное от таблицы и сопоставления
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rosterTable, rosterMap, shift],
  );

  const normOf = useMemo(() => normLookup(norms ?? []), [norms]);
  const skillOf = useCallback(
    (row: { typeBk: string }): Skill => normOf(row.typeBk)?.skill ?? 'local',
    [normOf],
  );
  const need = useMemo(() => {
    const counts = new Map<Skill, number>();
    for (const row of read?.rows ?? []) {
      const skill = skillOf(row);
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
    return counts;
  }, [read, skillOf]);

  // --- переходы между шагами ---

  /** Нормативы по типам файла; правки диспетчера по оставшимся типам сохраняем. */
  const prepareNorms = useCallback(() => {
    if (!read) return;
    setNorms((prev) => {
      const edited = new Map((prev ?? []).map((row) => [normKey(row.typeBk), row]));
      return normRows(read.rows, info?.norms).map((row) => {
        const own = edited.get(normKey(row.typeBk));
        return own ? { ...own, count: row.count } : row;
      });
    });
  }, [read, info]);

  const rosterSources = useMemo(() => {
    const sources: RosterSource[] = [];
    if (rosterFileRows.length) sources.push('file');
    if (controlRead && typeof controlRead !== 'string' && controlRead.matched > 0)
      sources.push('control');
    if (saved.data?.length) sources.push('saved');
    sources.push('rule');
    return sources;
  }, [rosterFileRows, controlRead, saved.data]);

  /** Сколько бригад даст каждый источник — счётчики в переключателе. */
  const rosterSourceCounts = useMemo((): Record<RosterSource, number> => {
    const control =
      controlRead && typeof controlRead !== 'string'
        ? new Set(controlRead.brigades.values()).size
        : 0;
    return {
      control,
      file: rosterFileRows.length,
      saved: saved.data?.length ?? 0,
      rule: rosterByRule(read?.rows.length ?? 0, shift).length,
    };
  }, [controlRead, rosterFileRows, saved.data, read, shift]);

  const rosterFor = useCallback(
    (source: RosterSource): RosterRow[] => {
      const rows = read?.rows ?? [];
      if (source === 'file') return rosterFileRows;
      if (source === 'saved') return rosterFromSaved(saved.data ?? []);
      if (source === 'control' && controlRead && typeof controlRead !== 'string') {
        // бригады, которые участок уже знает, — с сохранёнными id, навыками и транспортом
        const known = new Map(rosterFromSaved(saved.data ?? []).map((row) => [row.name, row]));
        return rosterFromControl(rows, controlRead.brigades, skillOf, shift).map(
          (row) => known.get(row.name) ?? row,
        );
      }
      return rosterByRule(rows.length, shift);
    },
    [read, rosterFileRows, saved.data, controlRead, skillOf, shift],
  );

  const chooseRosterSource = useCallback(
    (source: RosterSource) => {
      setRosterSource(source);
      setRoster(rosterFor(source));
    },
    [rosterFor],
  );

  const prepareRoster = useCallback(() => {
    if (roster !== null && rosterSource !== null) return;
    chooseRosterSource(rosterSources[0]);
  }, [roster, rosterSource, rosterSources, chooseRosterSource]);

  const rosterCheck = useMemo(() => checkRoster(roster ?? [], need), [roster, need]);

  // --- точки ---

  const points = useMemo(() => {
    const map = new Map<number, Point>();
    for (const row of read?.rows ?? []) {
      if (row.lat !== null && row.lon !== null) map.set(row.source, { lat: row.lat, lon: row.lon });
      else {
        const point = manualPoints.get(row.source) ?? geocode.hits.get(row.source);
        if (point) map.set(row.source, { lat: point.lat, lon: point.lon });
      }
    }
    return map;
  }, [read, manualPoints, geocode.hits]);

  const setManualPoint = useCallback((source: number, point: Point) => {
    setManualPoints((prev) => new Map(prev).set(source, point));
  }, []);

  // --- проверка шагов ---

  const requestsReady = Boolean(requestsTable && !files.requests?.error);
  const valid: Record<WizardStep, boolean> = {
    files:
      nameError === null &&
      officeAddress.trim() !== '' &&
      officePoint !== null &&
      requestsReady &&
      !files.control?.error &&
      !files.roster?.error,
    columns:
      requestErrors.length === 0 &&
      (read?.rows.length ?? 0) > 0 &&
      (files.control === null || (controlRead !== null && typeof controlRead !== 'string')) &&
      (files.roster === null || (rosterErrors.length === 0 && rosterFileRows.length > 0)),
    norms: norms !== null && norms.every((row) => normError(row) === null),
    roster: roster !== null && rosterCheck.errors.length === 0,
    points: !geocode.progress.running,
  };

  /** Всё для «Загрузить»; не готово — `null`. */
  function buildUpload(date: string, regionId: string | null): RegionUpload | null {
    if (!read || !norms || !roster || !officePoint || !rosterSource) return null;
    const office = { address: officeAddress.trim(), ...officePoint };
    const brigades = controlRead && typeof controlRead !== 'string' ? controlRead.brigades : null;
    return {
      regionId,
      name: name.trim(),
      office,
      norms: toRegionNorms(norms),
      roster: toRosterEngineers(roster, officePoint),
      requestsCsv: requestsCsv({
        rows: read.rows,
        date,
        normOf,
        points,
        officeAddress: office.address,
      }),
      controlCsv: brigades
        ? controlCsv({ rows: read.rows, date, brigades, officeAddress: office.address })
        : null,
      date,
      rosterSource: ROSTER_SOURCE_LABEL[rosterSource],
    };
  }

  return {
    region,
    name,
    setName,
    nameError,
    officeAddress,
    setOfficeAddress,
    officePick,
    setOfficePick,
    officePoint,
    officeLookup,
    files,
    pickFile,
    requestMap,
    setRequestMap: updateRequestMap,
    controlMap,
    setControlMap: updateControlMap,
    rosterMap,
    setRosterMap: updateRosterMap,
    read,
    requestErrors,
    controlRead,
    rosterErrors,
    rosterFileRows,
    norms,
    setNorms,
    prepareNorms,
    need,
    shift,
    saved,
    rosterSources,
    rosterSourceCounts,
    rosterSource,
    chooseRosterSource,
    roster,
    setRoster,
    prepareRoster,
    rosterCheck,
    points,
    manualPoints,
    setManualPoint,
    geocode,
    valid,
    buildUpload,
  };
}

export type RegionDraft = ReturnType<typeof useRegionDraft>;
