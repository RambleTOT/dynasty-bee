/**
 * Нормативы участка (§14, `anyRegionEnabled`): тип заявки BK → навык и длительность работ без
 * дороги. У участков кейса — нормативы оператора связи (у бэка — `_SKILL_BY_TYPE`, `_DURATION_BY_TYPE`);
 * у своего участка — свои: диспетчер задаёт их при загрузке, бэк хранит их в участке.
 */
import type { RegionNorms } from '@/api/types';
import { BK } from '@/lib/dictionaries';
import { isSkill, type Skill } from '@/lib/statuses';
import { DURATION_MAX, DURATION_MIN, type RequestRow } from './columnMap';

export interface Norm {
  skill: Skill;
  duration: number;
}

/** Нормативы оператора связи по типам BK выданных файлов. */
export const BEELINE_NORMS: Readonly<Record<string, Norm>> = {
  [BK.connection]: { skill: 'installation', duration: 70 },
  [BK.extra]: { skill: 'installation', duration: 20 },
  [BK.local]: { skill: 'local', duration: 30 },
  [BK.emergency]: { skill: 'emergency', duration: 80 },
};

/** Длительность по навыку для незнакомого типа — как у типа из нормативов оператора связи с тем же навыком. */
const DURATION_BY_SKILL: Record<Skill, number> = { installation: 70, local: 30, emergency: 80 };

/** Норматив участка, норматив оператора связи, угадали по названию или поправил диспетчер. */
export type NormSource = 'saved' | 'beeline' | 'guess' | 'edited';

export interface NormRow {
  /** Тип как в файле; `''` — тип не указан. */
  typeBk: string;
  count: number;
  skill: Skill;
  /** `null` — диспетчер стёр значение. */
  duration: number | null;
  source: NormSource;
}

export const normKey = (typeBk: string) => typeBk.trim().toLowerCase().replace(/ё/g, 'е');

/** Навык по названию типа: подключение и дозаказ, авария, остальное — локальные работы. */
export function guessSkill(typeBk: string): Skill {
  if (/авари|глобальн/iu.test(typeBk)) return 'emergency';
  if (/подключ|дозаказ|монтаж|установк|инсталл/iu.test(typeBk)) return 'installation';
  return 'local';
}

const beelineOf = (typeBk: string): Norm | null => {
  const key = normKey(typeBk);
  const found = Object.entries(BEELINE_NORMS).find(([name]) => normKey(name) === key);
  return found ? found[1] : null;
};

function savedOf(norms: RegionNorms | null | undefined, typeBk: string): Norm | null {
  const key = normKey(typeBk);
  const item = norms?.types.find((type) => normKey(type.type_bk) === key);
  if (!item || !isSkill(item.skill) || !Number.isFinite(item.duration_minutes)) return null;
  return { skill: item.skill, duration: item.duration_minutes };
}

/** Типы из файла — чаще встречающиеся выше; значения: норматив участка → оператора связи → по названию. */
export function normRows(
  requests: readonly Pick<RequestRow, 'typeBk'>[],
  saved: RegionNorms | null | undefined,
): NormRow[] {
  const counts = new Map<string, { typeBk: string; count: number }>();
  for (const { typeBk } of requests) {
    const key = normKey(typeBk);
    const entry = counts.get(key) ?? { typeBk: typeBk.trim(), count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.typeBk.localeCompare(b.typeBk, 'ru'))
    .map(({ typeBk, count }) => {
      const own = savedOf(saved, typeBk);
      if (own) return { typeBk, count, ...own, source: 'saved' };
      const beeline = beelineOf(typeBk);
      if (beeline) return { typeBk, count, ...beeline, source: 'beeline' };
      const skill = guessSkill(typeBk);
      return { typeBk, count, skill, duration: DURATION_BY_SKILL[skill], source: 'guess' };
    });
}

/** Ошибка длительности по типу: `null` — всё в порядке. */
export function normError(row: NormRow): string | null {
  const { duration } = row;
  if (duration === null || !Number.isInteger(duration)) return 'Укажите минуты';
  if (duration < DURATION_MIN || duration > DURATION_MAX)
    return `От ${DURATION_MIN} до ${DURATION_MAX} минут`;
  return null;
}

/** Норматив по типу заявки для строк CSV; тип без норматива — `null`. */
export function normLookup(rows: readonly NormRow[]): (typeBk: string) => Norm | null {
  const byKey = new Map(
    rows.flatMap((row) =>
      row.duration === null
        ? []
        : [[normKey(row.typeBk), { skill: row.skill, duration: row.duration }] as const],
    ),
  );
  return (typeBk) => byKey.get(normKey(typeBk)) ?? null;
}

/** Нормативы участка для бэка: без пустого типа и незаполненных строк. */
export function toRegionNorms(rows: readonly NormRow[]): RegionNorms {
  return {
    types: rows
      .filter((row) => row.typeBk !== '' && normError(row) === null)
      .map((row) => ({
        type_bk: row.typeBk,
        skill: row.skill,
        duration_minutes: row.duration ?? 0,
      })),
  };
}
