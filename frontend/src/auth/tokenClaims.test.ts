import { describe, expect, it } from 'vitest';
import { userFromToken } from './tokenClaims';

function tokenWith(claims: Record<string, unknown>): string {
  const json = JSON.stringify(claims);
  const bytes = new TextEncoder().encode(json);
  const base64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJIUzI1NiJ9.${base64}.signature`;
}

describe('userFromToken', () => {
  it('профиль инженера из claims (кириллица, регион, engineer_id)', () => {
    const token = tokenWith({
      sub: 'u-6',
      login: 'eng-east-06',
      name: 'Бригада Соколов',
      role: 'engineer',
      region_ids: ['east'],
      engineer_id: 'E06',
      exp: 4_000_000_000,
    });
    expect(userFromToken(token)).toEqual({
      id: 'u-6',
      login: 'eng-east-06',
      name: 'Бригада Соколов',
      role: 'engineer',
      region_ids: ['east'],
      engineer_id: 'E06',
    });
  });

  it('истёкший, битый или без роли — null', () => {
    expect(userFromToken(tokenWith({ role: 'engineer', exp: 1 }))).toBeNull();
    expect(userFromToken(tokenWith({ login: 'x' }))).toBeNull();
    expect(userFromToken('not-a-token')).toBeNull();
    expect(userFromToken(null)).toBeNull();
  });
});
