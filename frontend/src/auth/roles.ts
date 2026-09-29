import type { Role } from '@/api/types';

export const ROLES: readonly Role[] = ['dispatcher', 'operator', 'engineer'];

/** Главный экран роли. */
export const ROLE_HOME: Record<Role, string> = {
  dispatcher: '/dispatcher',
  operator: '/operator',
  engineer: '/engineer',
};

export const ROLE_LABEL: Record<Role, string> = {
  dispatcher: 'Диспетчер',
  operator: 'Оператор',
  engineer: 'Инженер',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Куда вести после входа: `next` из адреса, если он внутри раздела этой роли, иначе главная роли.
 * Чужие разделы и внешние адреса из `next` не принимаем.
 */
export function homeAfterLogin(role: Role, next: string | null): string {
  const home = ROLE_HOME[role];
  if (next && (next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}?`))) {
    return next;
  }
  return home;
}
