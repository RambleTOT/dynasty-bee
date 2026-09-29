import { ShieldX } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { ROLE_HOME } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';
import { PageLoader } from '@/pages/PageLoader';
import styles from '@/pages/pages.module.css';
import { Button, EmptyState } from '@/ui';

/** `/` — на главный экран своей роли или на вход. */
export function RoleHome() {
  const { status, role, logout } = useAuth();

  if (status === 'loading') return <PageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (role) return <Navigate to={ROLE_HOME[role]} replace />;

  // Бэк прислал роль, для которой у приложения нет раздела.
  return (
    <main className={styles.screen}>
      <div className={styles.card} role="alert">
        <EmptyState
          icon={ShieldX}
          title="Нет доступа"
          action={
            <Button variant="tertiary" onClick={() => void logout()}>
              Выйти
            </Button>
          }
        >
          Для этой учётной записи в приложении нет раздела.
        </EmptyState>
      </div>
    </main>
  );
}
