import { createContext, useContext } from 'react';
import type { Role, UserOut } from '@/api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  user: UserOut | null;
  /** Роль из `user.role`; `null` — нет пользователя или роль, для которой у фронта нет раздела. */
  role: Role | null;
  status: AuthStatus;
  login: (login: string, password: string) => Promise<UserOut>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth: нет AuthProvider выше по дереву');
  return value;
}
