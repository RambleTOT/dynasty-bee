/**
 * Вкладка «День» ведёт на последний открытый день (FRONTEND_SPEC §8.2) — адрес с регионом и видом.
 * sessionStorage: UI-мелочь в пределах вкладки браузера.
 */
const KEY = 'last_day';

export function rememberLastDay(path: string): void {
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // без sessionStorage вкладка ведёт на сегодня
  }
}

export function lastDayPath(): string | null {
  try {
    const path = window.sessionStorage.getItem(KEY);
    return path && path.startsWith('/dispatcher/day/') ? path : null;
  } catch {
    return null;
  }
}
