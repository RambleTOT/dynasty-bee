import { describe, expect, it } from 'vitest';
import { entryOf } from './useNewVersion';

describe('номер сборки на странице', () => {
  it('главный скрипт Vite из HTML и из адреса скрипта', () => {
    expect(
      entryOf('<script type="module" crossorigin src="/assets/index-Bcinfv-X.js"></script>'),
    ).toBe('/assets/index-Bcinfv-X.js');
    expect(entryOf('https://bee-dynasty.ru:8443/assets/index-Dt1kQUTL.js')).toBe(
      '/assets/index-Dt1kQUTL.js',
    );
    expect(entryOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    expect(entryOf(null)).toBeNull();
  });
});
