import { Upload } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import appBar from '@/app/AppBar.module.css';
import { DesktopLayout } from '@/app/layouts/DesktopLayout';
import { todayMsk } from '@/lib/time';
import { Button, cx } from '@/ui';
import { lastDayPath } from './lastDay';
import { RequestSearch } from './RequestSearch';

function DispatcherTabs() {
  const { pathname } = useLocation();
  const onDay = pathname.startsWith('/dispatcher/day/');
  return (
    <>
      <Link to="/dispatcher" className={cx(appBar.tab, !onDay && appBar.tabActive)}>
        Календарь
      </Link>
      <Link
        to={lastDayPath() ?? `/dispatcher/day/${todayMsk()}`}
        className={cx(appBar.tab, onDay && appBar.tabActive)}
      >
        День
      </Link>
      <span className={appBar.navSearch}>
        <RequestSearch />
      </span>
    </>
  );
}

/** «Загрузить CSV» — единственная жёлтая кнопка календаря (DS-01); открывает DS-02 (`modal=import`). */
function UploadCsvButton() {
  const { pathname } = useLocation();
  const [, setSearchParams] = useSearchParams();
  if (pathname !== '/dispatcher') return null;
  return (
    <Button
      variant="primary"
      icon={Upload}
      onClick={() =>
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('modal', 'import');
          return next;
        })
      }
    >
      Загрузить CSV
    </Button>
  );
}

/** Раскладка диспетчера: AppBar с вкладками «Календарь / День» и поиском заявки по номеру (§8.1). */
export default function DispatcherLayout() {
  return <DesktopLayout nav={<DispatcherTabs />} action={<UploadCsvButton />} />;
}
