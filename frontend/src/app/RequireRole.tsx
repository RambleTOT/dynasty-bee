import { Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/api/types';
import { ROLE_HOME } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';
import { notify } from '@/lib/notify';
import { PageLoader } from '@/pages/PageLoader';

interface RequireRoleProps {
  role: Role;
  children: ReactNode;
}

/** Пускает только свою роль: гостя — на /login?next=…, чужую роль — на её главный экран. */
export function RequireRole({ role, children }: RequireRoleProps) {
  const { status, role: userRole } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageLoader />;

  if (status === 'anonymous') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (userRole !== role) return <NoAccess to={userRole ? ROLE_HOME[userRole] : '/'} />;

  // Экраны ролей грузятся лениво (router.tsx) — пока чанк едет, показываем лоадер.
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

function NoAccess({ to }: { to: string }) {
  useEffect(() => {
    notify('Нет доступа к этому разделу', 'error');
  }, []);
  return <Navigate to={to} replace />;
}
