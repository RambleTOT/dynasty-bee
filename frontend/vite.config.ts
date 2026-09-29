/// <reference types="vitest/config" />
import { rmSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Бэкенд стенда. В dev (и в `vite preview`) запросы /api/* идут через прокси — CORS не нужен.
// DEV_API_TARGET=http://127.0.0.1:8001 — локальная копия бэка (README, «Локальный бэк»):
// из окружения или из .env.local.
const DEFAULT_API_TARGET = 'https://api.bee-dynasty.ru';

/**
 * Воркер моков MSW нужен только сборке на моках (VITE_USE_MOCKS=true): в боевой сборке файл из
 * public/ не оставляем — на сервере он не нужен и открыт всем.
 */
function dropMockWorker(useMocks: boolean): Plugin {
  let outDir = 'dist';
  return {
    name: 'drop-mock-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      if (!useMocks) rmSync(`${outDir}/mockServiceWorker.js`, { force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  // префикс '' — все переменные .env-файлов и окружения, не только VITE_*
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.DEV_API_TARGET || DEFAULT_API_TARGET;
  return {
    plugins: [react(), dropMockWorker(env.VITE_USE_MOCKS === 'true')],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: {
        // ws — сокет живых обновлений /api/v1/realtime/ws (docs/REALTIME.md)
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: apiTarget.startsWith('https'),
          ws: true,
        },
      },
    },
    // `npm run preview` — прод-сборка из dist/ с тем же прокси /api
    preview: { port: 4173 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // тесты не зависят от .env.local разработчика: без ключа Яндекс Карт, флагов правок бэка
      // и внешнего сервиса подсказок адреса
      env: { VITE_YANDEX_MAPS_KEY: '', VITE_FEATURES: '', VITE_ADDRESS_SUGGEST_URL: 'off' },
    },
  };
});
