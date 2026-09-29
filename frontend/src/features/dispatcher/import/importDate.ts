import { todayMsk } from '@/lib/time';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Дата импорта CSV по умолчанию — сегодня по Москве; в окне загрузки её можно сменить (поле
 * «Дата плана»), а с пустого дня DS-03 приходит дата этого дня.
 * Только в dev-сборке умолчание можно подменить `VITE_DEV_IMPORT_DATE=YYYY-MM-DD` в `.env.local`,
 * чтобы проверить импорт на стенде, не трогая сегодняшний демо-день. В прод-сборке переменная не читается.
 */
export function importDate(): string {
  const override: unknown = import.meta.env.DEV ? import.meta.env.VITE_DEV_IMPORT_DATE : undefined;
  return typeof override === 'string' && YMD.test(override) ? override : todayMsk();
}

/** Дата для поля: пришедшая из адреса, если она не в прошлом, иначе — по умолчанию. */
export function initialImportDate(requested: string | null | undefined): string {
  const fallback = importDate();
  return requested && YMD.test(requested) && requested >= todayMsk() ? requested : fallback;
}

/** День плана — сегодня или позже: прошедший день не планируем. */
export function isImportDate(value: string): boolean {
  return YMD.test(value) && (value >= todayMsk() || value === importDate());
}
