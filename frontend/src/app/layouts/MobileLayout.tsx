import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { PageLoader } from '@/pages/PageLoader';
import styles from './MobileLayout.module.css';

/**
 * Инженер: веб-страница для телефона 360–430 px (FRONTEND_SPEC §9.1). Шапка 56 px с меню ⋯ —
 * у экрана инженера: её пункты зависят от состояния смены.
 */
export function MobileLayout() {
  return (
    <div className={styles.root}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </div>
  );
}
