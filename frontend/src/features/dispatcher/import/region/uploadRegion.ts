import type { Point } from '@/adapters/canonicalCsv';
import {
  importReportFromError,
  importReportFromSummary,
  type ImportRegionReport,
} from '@/adapters/importReport';
import { engineersCsv } from '@/adapters/regionRoster';
import { importBeeline } from '@/api/data';
import { createRegion, patchRegion, putRegionRoster } from '@/api/regions';
import type { RegionNorms, RosterEngineer } from '@/api/types';
import { rememberRegions } from '@/lib/regions';

export interface RegionUpload {
  /** `null` — новый участок. */
  regionId: string | null;
  name: string;
  office: Point & { address: string };
  norms: RegionNorms;
  roster: RosterEngineer[];
  requestsCsv: string;
  controlCsv: string | null;
  date: string;
  /** «Из контрольного файла», «По правилу»… — для отчёта. */
  rosterSource: string;
}

const csvFile = (text: string, name: string) => new File([text], name, { type: 'text/csv' });

/**
 * «Загрузить» мастера «Другой участок» (§14): участок (создать или обновить название, офис и
 * нормативы) → ростер участка → импорт CSV в формате оператора связи с ростером `engineers_file`.
 * Участок создан, а дальше сбой — `onCreated` уже отдал его id: повтор обновит участок, а не создаст
 * второй. Ошибка импорта — карточка отчёта с ошибкой, как у участков кейса.
 */
export async function uploadRegion(
  upload: RegionUpload,
  onCreated: (regionId: string) => void,
): Promise<ImportRegionReport> {
  const body = { name: upload.name, office: upload.office, norms: upload.norms };
  const created = upload.regionId === null;
  const region =
    upload.regionId === null ? await createRegion(body) : await patchRegion(upload.regionId, body);
  rememberRegions([region]);
  const regionId = region.region_id;
  if (created) onCreated(regionId);

  await putRegionRoster(regionId, upload.roster);
  try {
    const summary = await importBeeline({
      requestsFile: csvFile(upload.requestsCsv, 'requests.csv'),
      controlFile: upload.controlCsv === null ? null : csvFile(upload.controlCsv, 'control.csv'),
      engineersFile: csvFile(engineersCsv(upload.roster), 'engineers.csv'),
      regionId,
      date: upload.date,
    });
    return importReportFromSummary(regionId, summary, upload.controlCsv !== null, {
      created,
      name: region.name || upload.name,
      rosterSource: upload.rosterSource,
      normTypes: upload.norms.types.length,
    });
  } catch (error) {
    return importReportFromError(regionId, error);
  }
}
