import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStorage } from './tokenStorage';

afterEach(() => {
  vi.restoreAllMocks();
  tokenStorage.clear();
});

describe('tokenStorage', () => {
  it('хранит токен в localStorage.auth_token', () => {
    tokenStorage.set('t1');
    expect(window.localStorage.getItem('auth_token')).toBe('t1');
    expect(tokenStorage.get()).toBe('t1');
    tokenStorage.clear();
    expect(tokenStorage.get()).toBeNull();
  });

  it('localStorage недоступен — токен в памяти, без исключений', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => tokenStorage.set('t2')).not.toThrow();
    expect(tokenStorage.get()).toBe('t2');
    tokenStorage.clear();
    expect(tokenStorage.get()).toBeNull();
  });
});
