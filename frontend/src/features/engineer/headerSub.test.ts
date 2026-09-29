import { describe, expect, it } from 'vitest';
import { headerSub } from './headerSub';

describe('подпись в шапке инженера', () => {
  it('регион из токена и дата дня; чего нет — не пишем', () => {
    expect(headerSub(['east'], '2026-09-29')).toBe('Восток · 29 сентября');
    expect(headerSub(['south_east'], null)).toBe('Юго-восток');
    expect(headerSub(undefined, '2026-10-05')).toBe('5 октября');
    expect(headerSub(['moon'], null)).toBeNull();
  });
});
