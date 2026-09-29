/**
 * Цвета маршрутов (FRONTEND_SPEC §10.2, DESIGN_SPEC §2.5): 12 токенов `--route-N`.
 * Цвет бригады — индекс в ростере региона, отсортированном по id, по модулю 12.
 * Повторный цвет (бригад больше 12) — линия пунктиром.
 */
export const ROUTE_COLOR_COUNT = 12;

/** Номер цвета 1…12 для CSS-классов и токенов. */
export type RouteColorIndex = number;

export interface EngineerColor {
  /** 1…12 */
  index: RouteColorIndex;
  /** `var(--route-N)` — для CSS (фон, рамка, stroke в CSS-правилах). */
  css: string;
  /** Цвет повторяется: линию маршрута рисуем пунктиром. */
  dashed: boolean;
}

export const routeColorVar = (index: RouteColorIndex) => `var(--route-${index})`;

const byId = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true });

export function colorForPosition(position: number): EngineerColor {
  const index = (position % ROUTE_COLOR_COUNT) + 1;
  return { index, css: routeColorVar(index), dashed: position >= ROUTE_COLOR_COUNT };
}

/** Цвета бригад региона: сортировка по id, затем позиция → цвет. */
export function engineerColors(ids: readonly string[]): Map<string, EngineerColor> {
  const sorted = [...new Set(ids)].sort(byId);
  return new Map(sorted.map((id, position) => [id, colorForPosition(position)]));
}

/** Значение токена во время работы — для библиотек, которые не понимают var() (атрибуты SVG, canvas). */
export function resolveCssVar(name: string, fallbackVar = '--text-primary'): string {
  if (typeof window === 'undefined') return '';
  const style = getComputedStyle(document.documentElement);
  return (style.getPropertyValue(name) || style.getPropertyValue(fallbackVar)).trim();
}

/** Цвет маршрута по номеру — для Leaflet (он пишет цвет в атрибут stroke, где var() не работает). */
export const routeColorValue = (index: RouteColorIndex) => resolveCssVar(`--route-${index}`);
