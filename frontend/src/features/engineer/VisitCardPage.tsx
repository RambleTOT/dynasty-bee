import { Info, Navigation } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  currentVisit,
  isPendingStatus,
  pageState,
  type EngineerDayModel,
} from '@/adapters/engineerDay';
import { effectiveRoute, linkTransport, routeUrlTo } from '@/adapters/engineerRoute';
import { useAuth } from '@/auth/useAuth';
import { FEATURES } from '@/config';
import { searchParam, useSearchState } from '@/hooks/useSearchState';
import { requestNoShort } from '@/lib/engineerLabels';
import { Button, buttonClassName, EmptyState, InfoGrid } from '@/ui';
import { DayError, DaySkeleton } from './DayStates';
import { DoneToast } from './DoneToast';
import { EngineerHeader } from './EngineerHeader';
import { headerSub } from './headerSub';
import { EngineerMenu } from './EngineerMenu';
import { EngineerPage } from './EngineerPage';
import { IncidentSheet } from './IncidentSheet';
import { InterruptSheet } from './InterruptSheet';
import { ENGINEER_HOME } from './paths';
import { changedKey, isSeen, markSeen, useSeenVersion } from './seen';
import { StatusPanel } from './StatusPanel';
import { useEngineerDay, useEngineerRoute, useShiftEnd } from './useEngineerDay';
import { AddressText, CardChips, EquipmentLine } from './VisitBits';
import { positionLabel, visitDetails } from './visitFacts';
import list from './VisitList.module.css';
import styles from './VisitCardPage.module.css';

/** Шторки карточки — для текущей заявки (§4): `sheet=interrupt|incident`. */
const cardSearch = {
  sheet: searchParam.enum(['interrupt', 'incident'] as const),
};

/** «Маршрут в Яндекс Картах» — от старта `/me/route` через точки до этой заявки (§9.2 E-03.1). */
function YandexRouteLink({ day, visitId }: { day: EngineerDayModel; visitId: string }) {
  const route = useEngineerRoute();
  const label = 'Маршрут в Яндекс Картах';
  if (route.isPending) {
    return (
      <Button variant="tertiary" size="lg" fullWidth icon={Navigation} loading>
        {label}
      </Button>
    );
  }
  const model = effectiveRoute(route.data, day.visits);
  const url = routeUrlTo(model, visitId, linkTransport(day.engineer, model));
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      className={buttonClassName({ variant: 'tertiary', size: 'lg', fullWidth: true })}
    >
      <Navigation size={20} aria-hidden />
      {label}
    </a>
  );
}

/**
 * `/engineer/request/:id` — E-03.1 / E-05 «Карточка заявки»: подробности, «Почему это вам» и низ по
 * статусу: у текущей — панель статуса, у запланированной — «Начать можно после…» и ссылка
 * в Яндекс Карты, у закрытой — без кнопок. Открытие снимает флаг «Изменено» локально.
 */
export default function VisitCardPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const query = useEngineerDay();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchState(cardSearch);
  useSeenVersion();

  const day = query.data;
  const visit = day?.visits.find((item) => item.id === id) ?? null;
  const current = day ? currentVisit(day) : null;
  const shiftEnd = useShiftEnd(day, () => navigate(`${ENGINEER_HOME}?sheet=shift_end`));

  // «Изменено» снимаем при открытии; на открытой карточке флаг ещё виден
  const [keepChanged, setKeepChanged] = useState<string | null>(null);
  const visitId = visit?.id ?? null;
  const changed = visit?.flags.includes('changed') ?? false;
  useEffect(() => {
    if (!visitId || !changed) return;
    const key = changedKey(visitId);
    if (isSeen(key)) return;
    setKeepChanged(visitId);
    markSeen(key);
  }, [visitId, changed]);

  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(ENGINEER_HOME));
  const toList = () => navigate(ENGINEER_HOME);

  const header = (
    <EngineerHeader
      name={day?.engineer.name || user?.name || ''}
      sub={headerSub(user?.region_ids, day?.date)}
      onBack={goBack}
      menu={
        <EngineerMenu
          day={day}
          onUnavailable={() => navigate(`${ENGINEER_HOME}?sheet=unavailable`)}
          onShiftEnd={shiftEnd.request}
        />
      }
    />
  );

  if (!day) {
    return (
      <EngineerPage header={header}>
        {query.isError ? (
          <DayError onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : (
          <DaySkeleton />
        )}
      </EngineerPage>
    );
  }

  if (!visit) {
    return (
      <EngineerPage header={header}>
        <div className={list.card}>
          <EmptyState
            title="Заявка не найдена"
            action={
              <Button variant="tertiary" size="sm" onClick={toList}>
                К списку заявок
              </Button>
            }
          >
            Её могли передать другому инженеру
          </EmptyState>
        </div>
      </EngineerPage>
    );
  }

  const state = pageState(day);
  const working = state === 'shift' || state === 'unavailable';
  const isCurrent = current?.id === visit.id;
  const plannedNext = !isCurrent && visit.status === 'planned';

  let footer: ReactNode = null;
  if (isCurrent && working) {
    footer = (
      <StatusPanel
        visit={visit}
        completeOnly={state === 'unavailable'}
        onInterrupt={() => setSearch({ sheet: 'interrupt' })}
        onIncident={() => setSearch({ sheet: 'incident' })}
        // выполнили — к списку: там текущей стала следующая и тост «Заявка … выполнена»
        onStep={(action) => action === 'complete' && toList()}
      />
    );
  } else if (plannedNext) {
    footer = <YandexRouteLink day={day} visitId={visit.id} />;
  }

  return (
    <EngineerPage header={header} footer={footer} routeColor={day.engineer.routeColor}>
      <section className={list.card} aria-labelledby="visit-title">
        <div className={list.eyebrow}>{positionLabel(visit, isCurrent, day.total)}</div>
        <div className={list.titleRow}>
          <h1 id="visit-title" className={list.title}>
            {visit.title}
          </h1>
          <CardChips visit={visit} keepChanged={keepChanged === visit.id} />
        </div>
        <div className={list.address}>
          <AddressText address={visit.address} />
        </div>
        <InfoGrid items={visitDetails(visit)} />
        <EquipmentLine equipment={visit.equipment} />
        {visit.whyYou && (
          <p className={styles.why}>
            <span className={styles.whyLabel}>Почему это вам:</span> {visit.whyYou}
          </p>
        )}
        {isPendingStatus(visit.status) && (
          <div className={list.waiting}>
            Ждёт решения диспетчера. Можно ехать к следующей заявке
          </div>
        )}
      </section>
      {plannedNext && current && (
        <div className={styles.note}>
          <Info size={16} className={styles.noteIcon} aria-hidden />
          <span>Начать можно после завершения текущей заявки {requestNoShort(current.id)}</span>
        </div>
      )}
      <DoneToast />

      {search.sheet === 'interrupt' && isCurrent && state === 'shift' && (
        <InterruptSheet
          visit={visit}
          dayDate={day.date}
          onClose={() => setSearch({ sheet: null })}
          onSent={toList}
        />
      )}
      {search.sheet === 'incident' &&
        FEATURES.engineerIncident &&
        isCurrent &&
        state === 'shift' && (
          <IncidentSheet
            visit={visit}
            engineer={day.engineer}
            onClose={() => setSearch({ sheet: null })}
          />
        )}
    </EngineerPage>
  );
}
