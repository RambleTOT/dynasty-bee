/// <reference types="vitest/config" />
import { rmSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Бэкенд стенда. В dev (и в `vite preview`) запросы /api/* идут через прокси — CORS не нужен.
// DEV_API_TARGET=http://127.0.0.1:8001 — локальная копия бэка (README, «Локальный бэк»).
const API_TARGET = process.env.DEV_API_TARGET || 'https://api.bee-dynasty.ru';

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

export default defineConfig(({ mode }) => ({
  plugins: [react(), dropMockWorker(loadEnv(mode, process.cwd(), 'VITE_').VITE_USE_MOCKS === 'true')],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // ws — сокет живых обновлений /api/v1/realtime/ws (docs/REALTIME.md)
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: API_TARGET.startsWith('https'),
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // тесты не зависят от .env.local разработчика: без ключа Яндекс Карт, флагов правок бэка
    // и внешнего сервиса подсказок адреса
    env: { VITE_YANDEX_MAPS_KEY: '', VITE_FEATURES: '', VITE_ADDRESS_SUGGEST_URL: 'off' },
  },
}));
