import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/api/auth';
import { UNAUTHORIZED_EVENT } from '@/api/client';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { dismissAll } from '@/lib/notify';
import { isRole } from './roles';
import { userFromToken } from './tokenClaims';
import { tokenStorage } from './tokenStorage';
import { AuthContext, type AuthContextValue, type AuthStatus } from './useAuth';

/**
 * Сессия: токен — в localStorage, профиль — запрос `me` (только если есть токен).
 * Стоит корневым маршрутом внутри роутера (router.tsx), чтобы при выходе вести на /login.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => tokenStorage.get());

  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }) => {
      try {
        return await authApi.me(signal);
      } catch (error) {
        // инженеру бэк отвечает на /auth/me 403 — профиль из токена (docs/API_NOTES.md)
        const fromToken =
          isApiError(error) && error.status === 403 ? userFromToken(tokenStorage.get()) : null;
        if (fromToken) return fromToken;
        throw error;
      }
    },
    enabled: token !== null,
    staleTime: Infinity,
  });

  // Токен, кэш и адрес меняем в одном обновлении, чтобы защищённый экран не отрисовался без
  // пользователя. `to = null` — адрес не трогаем. Тосты прежней роли («ждёт решения») закрываем.
  const endSession = useCallback(
    (to: string | null) => {
      tokenStorage.clear();
      setToken(null);
      queryClient.clear();
      dismissAll();
      if (to) navigate(to, { replace: true });
    },
    [navigate, queryClient],
  );

  // Сессия истекла: на /login с `next`, чтобы после входа вернуться туда же.
  // Уже на странице входа — адрес (и его `next`) не трогаем.
  useEffect(() => {
    const onUnauthorized = () => {
      const { pathname, search } = window.location;
      if (pathname.startsWith('/login')) endSession(null);
      else if (pathname === '/') endSession('/login');
      else endSession(`/login?next=${encodeURIComponent(pathname + search)}`);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [endSession]);

  const login = useCallback(
    async (loginName: string, password: string) => {
      // Старый токен (истёкший или непроверенный) не шлём: 401 здесь — неверный пароль, а не конец сессии.
      tokenStorage.clear();
      const { access_token, user } = await authApi.login({ login: loginName, password });
      tokenStorage.set(access_token);
      queryClient.setQueryData(queryKeys.me, user);
      setToken(access_token);
      return user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // выходим в любом случае: токен мог истечь, бэк мог не ответить
    }
    endSession('/login');
  }, [endSession]);

  const user = token ? (me.data ?? null) : null;
  // Профиль не получен (сеть, 5xx после повторов) — считаем гостем: вход заново починит сессию.
  const status: AuthStatus = user
    ? 'authenticated'
    : token && !me.isError
      ? 'loading'
      : 'anonymous';

  const value = useMemo<AuthContextValue>(
    () => ({ user, role: user && isRole(user.role) ? user.role : null, status, login, logout }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
