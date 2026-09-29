const KEY = 'auth_token';

// Если localStorage недоступен (приватный режим, запрет cookie), токен живёт в памяти до перезагрузки.
let fallback: string | null = null;

/** Токен доступа в `localStorage['auth_token']`. Срок жизни — 21 день (FRONTEND_SPEC §5.1). */
export const tokenStorage = {
  get(): string | null {
    try {
      return window.localStorage.getItem(KEY) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(token: string): void {
    try {
      window.localStorage.setItem(KEY, token);
      fallback = null;
    } catch {
      fallback = token;
    }
  },
  clear(): void {
    fallback = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // нечего очищать
    }
  },
};
