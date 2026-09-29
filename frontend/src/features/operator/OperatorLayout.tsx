import { Plus, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DesktopLayout } from '@/app/layouts/DesktopLayout';
import { Button } from '@/ui';

/** Кнопка в AppBar зависит от роута (FRONTEND_SPEC §8.3.5). */
function OperatorAction() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (pathname === '/operator') {
    return (
      <Button variant="primary" icon={Plus} onClick={() => navigate('/operator/new')}>
        Добавить заявку
      </Button>
    );
  }
  return (
    <Button variant="secondary" icon={Search} onClick={() => navigate('/operator')}>
      Найти заявку
    </Button>
  );
}

/** Раскладка оператора: AppBar без вкладок, действие справа. */
export default function OperatorLayout() {
  return <DesktopLayout action={<OperatorAction />} />;
}
