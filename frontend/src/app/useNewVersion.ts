import { useEffect } from 'react';
import { fetchSiteIndex } from '@/api/client';
import { notify } from '@/lib/notify';

/** Главный скрипт сборки Vite: `/assets/index-<хеш>.js`. */
const ENTRY = /\/assets\/index-[\w-]+\.js/;

/** Номер сборки в HTML страницы; нет — `null`. */
export function entryOf(html: string | null | undefined): string | null {
  return html?.match(ENTRY)?.[0] ?? null;
}

/**
 * Вкладка открыта давно, а на сайт выложили новую сборку — в ней работает старый код без правок.
 * Раз в 5 минут и при возврате во вкладку сверяем главный скрипт страницы с тем, что отдаёт
 * сервер; другой — тост «Вышла новая версия сайта» с «Обновить». Только в прод-сборке.
 */
export function useNewVersionNotice(intervalMs = 5 * 60_000) {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
    const current = entryOf(script?.src);
    if (!current) return;
    let notified = false;
    const check = async () => {
      if (notified || document.visibilityState !== 'visible') return;
      const latest = entryOf(await fetchSiteIndex());
      if (!latest || latest === current || notified) return;
      notified = true;
      notify('Вышла новая версия сайта', 'info', {
        description: 'Обновите страницу, чтобы работать с исправлениями',
        persistent: true,
        action: { label: 'Обновить', onClick: () => window.location.reload() },
      });
    };
    const timer = window.setInterval(() => void check(), intervalMs);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}
