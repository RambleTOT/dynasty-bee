import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { ROLE_LABEL } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';
import { regionLabel } from '@/lib/dictionaries';
import { REGIONS } from '@/lib/statuses';
import { Button, Logo } from '@/ui';
import styles from './AppBar.module.css';

/** Подпись под именем: «Диспетчер · все регионы» / «Оператор поддержки» (FRONTEND_SPEC §8.1, §8.3.5). */
function useRoleCaption(): string {
  const { user, role } = useAuth();
  if (!role) return '';
  if (role === 'operator') return 'Оператор поддержки';
  const regions = user?.region_ids ?? [];
  const all = regions.length === 0 || REGIONS.every((id) => regions.includes(id));
  const where = all ? 'все регионы' : regions.map(regionLabel).join(', ');
  return `${ROLE_LABEL[role]} · ${where}`;
}

/** Шапка десктопа 64 px: логотип, вкладки роли, главное действие экрана, пользователь, «Выйти». */
export function AppBar({ nav, action }: { nav?: ReactNode; action?: ReactNode }) {
  const { user, logout } = useAuth();
  const caption = useRoleCaption();
  return (
    <header className={styles.bar}>
      <Logo size={32} />
      {nav && <nav className={styles.nav}>{nav}</nav>}
      <span className={styles.spacer} />
      {action}
      <div className={styles.user}>
        <div className={styles.who}>
          <div className={styles.name}>{user?.name}</div>
          <div className={styles.caption}>{caption}</div>
        </div>
        <Button variant="ghost" size="sm" icon={LogOut} onClick={() => void logout()}>
          Выйти
        </Button>
      </div>
    </header>
  );
}
