import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '.*/', // скрытые папки: локальные рабочие копии и настройки редакторов
    'dist',
    'coverage',
    'design/_unpacked',
    'public/mockServiceWorker.js',
    'src/api/schema.d.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactRefresh.configs.vite()],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Сеть — только через src/api/client.ts (docs/ARCHITECTURE.md).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/api/client.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Запросы к API — только через src/api/client.ts' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'fetch',
          message: 'Запросы к API — только через src/api/client.ts',
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
  },
]);
