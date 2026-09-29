import { Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { PageLoader } from '@/pages/PageLoader';
import { AppBar } from '../AppBar';
import styles from './DesktopLayout.module.css';

/** Диспетчер и оператор: десктоп от 1280 px, AppBar сверху, экран — на всю оставшуюся высоту. */
export function DesktopLayout({ nav, action }: { nav?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.root}>
      <AppBar nav={nav} action={action} />
      <main className={styles.main}>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
