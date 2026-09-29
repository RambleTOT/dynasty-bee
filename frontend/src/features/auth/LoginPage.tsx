import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { errorMessage, isApiError } from '@/api/errors';
import { homeAfterLogin } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';
import { PageLoader } from '@/pages/PageLoader';
import { Button, Callout, IconButton, Input, Logo } from '@/ui';
import styles from './LoginPage.module.css';

/** S-01 Вход (FRONTEND_SPEC §8.1, макет S-01). Без регистрации и демо-кнопок (D-17). */
export function LoginPage() {
  const { status, role, login } = useAuth();
  const [searchParams] = useSearchParams();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (status === 'loading') return <PageLoader />;
  // Вошли (или уже были в сессии) — на главную своей роли.
  if (status === 'authenticated') {
    return <Navigate to={role ? homeAfterLogin(role, searchParams.get('next')) : '/'} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await login(loginValue.trim(), password);
    } catch (err) {
      setError(
        isApiError(err) && err.status === 401 ? 'Неверный логин или пароль' : errorMessage(err),
      );
      setPending(false);
    }
  }

  return (
    <main className={styles.screen}>
      <form className={styles.card} onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className={styles.head}>
          <Logo size={44} product={null} />
          <div>
            <h1 className={styles.title}>Маршруты инженеров</h1>
            <p className={styles.subtitle}>Вход для сотрудников</p>
          </div>
        </div>
        <div className={styles.fields}>
          <Input
            label="Логин"
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={loginValue}
            onChange={(event) => setLoginValue(event.target.value)}
          />
          <Input
            label="Пароль"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            trailing={
              <IconButton
                icon={showPassword ? EyeOff : Eye}
                label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                variant="ghost"
                size="sm"
                onClick={() => setShowPassword((value) => !value)}
              />
            }
          />
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!loginValue.trim() || !password}
        >
          Войти
        </Button>
      </form>
      <footer className={styles.footer}>Кейс от Билайн Бизнес · ЛЦТ 2026 · прототип</footer>
    </main>
  );
}
