import { TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from '@/ui';
import styles from '@/pages/pages.module.css';

/** Экран ошибки: и для корневого ErrorBoundary, и как `errorElement` маршрутов. */
export function ErrorFallback() {
  return (
    <main className={styles.screen}>
      <div className={styles.card} role="alert">
        <EmptyState
          icon={TriangleAlert}
          title="Что-то пошло не так"
          action={
            <Button variant="tertiary" onClick={() => window.location.reload()}>
              Перезагрузить
            </Button>
          }
        />
      </div>
    </main>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Корневой перехватчик ошибок рендера вне роутера (ошибки экранов ловит `errorElement`). */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Необработанная ошибка интерфейса', error, info.componentStack);
  }

  render() {
    return this.state.hasError ? <ErrorFallback /> : this.props.children;
  }
}
