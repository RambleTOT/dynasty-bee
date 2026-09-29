import { SearchX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ROLE_HOME } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';
import { Button, EmptyState } from '@/ui';
import styles from './pages.module.css';

export function NotFound() {
  const { role } = useAuth();
  const navigate = useNavigate();
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <EmptyState
          icon={SearchX}
          title="Страница не найдена"
          action={
            <Button variant="tertiary" onClick={() => navigate(role ? ROLE_HOME[role] : '/login')}>
              {role ? 'На главную' : 'Ко входу'}
            </Button>
          }
        >
          Проверьте адрес или вернитесь на главный экран.
        </EmptyState>
      </div>
    </main>
  );
}
