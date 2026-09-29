import { describe, expect, it } from 'vitest';
import { homeAfterLogin, isRole } from './roles';

describe('homeAfterLogin', () => {
  it('без next — главная роли', () => {
    expect(homeAfterLogin('dispatcher', null)).toBe('/dispatcher');
    expect(homeAfterLogin('engineer', null)).toBe('/engineer');
  });

  it('next внутри раздела роли — туда', () => {
    expect(homeAfterLogin('dispatcher', '/dispatcher/day/2026-09-28?view=map')).toBe(
      '/dispatcher/day/2026-09-28?view=map',
    );
    expect(homeAfterLogin('operator', '/operator?region=east')).toBe('/operator?region=east');
  });

  it('чужой раздел, похожий префикс и внешние адреса — главная роли', () => {
    expect(homeAfterLogin('engineer', '/dispatcher')).toBe('/engineer');
    expect(homeAfterLogin('dispatcher', '/dispatcherX')).toBe('/dispatcher');
    expect(homeAfterLogin('dispatcher', '//evil.example/dispatcher')).toBe('/dispatcher');
    expect(homeAfterLogin('dispatcher', 'https://evil.example')).toBe('/dispatcher');
  });
});

describe('isRole', () => {
  it('только три роли фронта', () => {
    expect(isRole('dispatcher')).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
