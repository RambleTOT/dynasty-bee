import { List, LogOut, Map as MapIcon, Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  currentVisit,
  hasActiveVisit,
  latestBanner,
  pageState,
  plannedLeft,
  type EngineerBannerModel,
  type EngineerPageState,
  pendingOutcomes,
  type EngineerVisitModel,
  type PendingOutcome,
} from '@/adapters/engineerDay';
import { effectiveRoute } from '@/adapters/engineerRoute';
import { useAuth } from '@/auth/useAuth';
import { FEATURES } from '@/config';
import { requestNoShort } from '@/lib/engineerLabels';
import { notify } from '@/lib/notify';
import { searchParam, useSearchState } from '@/hooks/useSearchState';
import { Button, SegmentedControl, type SegmentOption } from '@/ui';
import { DayError, DaySkeleton, NoVisits, PlanNotPublished } from './DayStates';
import { DoneToast } from './DoneToast';
import { EngineerHeader } from './EngineerHeader';
import { headerSub } from './headerSub';
import { EngineerMenu } from './EngineerMenu';
import { EngineerPage } from './EngineerPage';
import { IncidentSheet } from './IncidentSheet';
import { InterruptSheet } from './InterruptSheet';
import { MapScreen } from './MapScreen';
import { visitPath } from './paths';
import { PlanChangedBanner, UnavailableBanner } from './PlanChangedBanner';
import { PreviewScreen } from './PreviewScreen';
import { forgetStaleChanged, isSeen, markSeen, useSeenVersion } from './seen';
import { ShiftEndConfirm } from './ShiftEndConfirm';
import { ShiftSummary } from './ShiftSummary';
import { TransportSheet } from './TransportSheet';
import { UnavailableSheet } from './UnavailableSheet';
import { useEngineerDay, useEngineerRoute, useShiftEnd } from './useEngineerDay';
import { MyVisits } from './VisitList';
import { VisitSheet } from './VisitSheet';

type View = 'list' | 'map';

/**
 * Вид и открытая шторка — в адресе (§4): `view=list|map`, `sheet=…` (E-02, E-06, E-07, E-08),
 * `point=№` — заявка, на которую нажали на карте.
 */
const engineerSearch = {
  view: searchParam.enum(['list', 'map'] as const, 'list'),
  point: searchParam.string(),
  sheet: searchParam.enum([
    'transport',
    'interrupt',
    'incident',
    'unavailable',
    'shift_end',
  ] as const),
};

type Sheet = NonNullable<ReturnType<typeof engineerSearch.sheet.parse>>;

const VIEW_OPTIONS: SegmentOption<View>[] = [
  { value: 'list', label: 'Список', icon: List },
  { value: 'map', label: 'Карта', icon: MapIcon },
];

/** Экраны с «Список / Карта»: до смены (E-01) и на смене (E-03 / E-04). */
const ROUTE_STATES: readonly EngineerPageState[] = ['preview', 'shift', 'unavailable'];

/** «Посмотреть» у баннера без заявки — к «Далее по маршруту» (§9.2 E-09). */
function scrollToRoute() {
  window.requestAnimationFrame(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById('engineer-next')
      ?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
}

const OUTCOME_TEXT: Record<PendingOutcome['kind'], (no: string) => string> = {
  cancel_confirmed: (no) => `Диспетчер подтвердил отмену ${no}`,
  reschedule_confirmed: (no) => `Диспетчер подтвердил перенос ${no}`,
  returned: (no) => `Диспетчер вернул ${no} — заявка снова в маршруте`,
};

/** Решение диспетчера по «Прервать» — тостом: бэк баннера об этом не присылает. */
function usePendingOutcomes(visits: readonly EngineerVisitModel[] | undefined) {
  const before = useRef<readonly EngineerVisitModel[] | null>(null);
  useEffect(() => {
    if (!visits) return;
    if (before.current) {
      for (const outcome of pendingOutcomes(before.current, visits)) {
        notify(
          OUTCOME_TEXT[outcome.kind](requestNoShort(outcome.id)),
          outcome.kind === 'returned' ? 'info' : 'success',
        );
      }
    }
    before.current = visits;
  }, [visits]);
}

/**
 * `/engineer` — экран инженера по состоянию дня (FRONTEND_SPEC §9.1): загрузка, ошибка, план не
 * опубликован, заявок нет, E-01 до смены, E-03 / E-04 на смене, E-10 после.
 */
export default function EngineerApp() {
  const { user, logout } = useAuth();
  const query = useEngineerDay();
  const [search, setSearch] = useSearchState(engineerSearch);
  const navigate = useNavigate();
  useSeenVersion();
  const day = query.data;
  const state = day ? pageState(day) : null;
  const mapOpen = search.view === 'map' && state !== null && ROUTE_STATES.includes(state);
  const route = useEngineerRoute({ enabled: mapOpen, poll: true });

  const openSheet = (sheet: Sheet) => setSearch({ sheet });
  const closeSheet = () => setSearch({ sheet: null });
  const shiftEnd = useShiftEnd(day, () => openSheet('shift_end'));

  // флаг «Изменено» пропал из плана — забываем отметку «карточку открывали»
  const visits = day?.visits;
  useEffect(() => {
    if (visits) forgetStaleChanged(visits);
  }, [visits]);
  usePendingOutcomes(visits);

  const header = (
    <EngineerHeader
      name={day?.engineer.name || user?.name || ''}
      sub={headerSub(user?.region_ids, day?.date)}
      menu={
        <EngineerMenu
          day={day}
          onUnavailable={() => openSheet('unavailable')}
          onShiftEnd={shiftEnd.request}
        />
      }
    />
  );

  if (!day || !state) {
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

  const routeColor = day.engineer.routeColor;
  const current = currentVisit(day);

  // E-09: самый свежий непросмотренный баннер; «Посмотреть» — карточка заявки или список
  const viewBanner = (banner: EngineerBannerModel) => {
    markSeen(banner.key);
    if (banner.requestId && day.visits.some((visit) => visit.id === banner.requestId)) {
      navigate(visitPath(banner.requestId));
      return;
    }
    setSearch({ view: 'list', sheet: null });
    scrollToRoute();
  };
  const withRoute = ROUTE_STATES.includes(state);
  const banner = withRoute ? latestBanner(day.banners, isSeen) : null;
  const bannerNode = banner ? (
    <PlanChangedBanner banner={banner} onView={() => viewBanner(banner)} />
  ) : state === 'unavailable' ? (
    <UnavailableBanner availableUntil={day.engineer.availableUntil} />
  ) : null;

  // Действия внизу экрана: E-01 — «Начать смену» и «Не выйду сегодня» (когда бэк примет
  // unavailable до смены, ⏳ 8.5); E-10 — «Выйти»
  const footer =
    state === 'finished' ? (
      <Button variant="secondary" size="lg" fullWidth icon={LogOut} onClick={() => void logout()}>
        Выйти
      </Button>
    ) : state === 'preview' ? (
      <>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon={Play}
          onClick={() => openSheet('transport')}
        >
          Начать смену
        </Button>
        {FEATURES.unavailableBeforeShift && (
          <Button variant="danger" size="lg" fullWidth onClick={() => openSheet('unavailable')}>
            Не выйду сегодня
          </Button>
        )}
      </>
    ) : null;

  const viewSwitch = withRoute && (
    <SegmentedControl
      label="Вид"
      fullWidth
      options={VIEW_OPTIONS}
      value={search.view}
      onChange={(view) => setSearch({ view })}
    />
  );

  return (
    <EngineerPage
      header={header}
      banner={bannerNode}
      footer={footer}
      fill={mapOpen}
      routeColor={routeColor}
    >
      {mapOpen ? (
        <MapScreen
          day={day}
          route={effectiveRoute(route.data, day.visits)}
          viewSwitch={viewSwitch}
          withSheet={state !== 'preview'}
          onOpenPoint={(point) => setSearch({ point })}
        />
      ) : (
        <>
          {viewSwitch}
          {state === 'unpublished' && <PlanNotPublished />}
          {state === 'empty' && <NoVisits />}
          {state === 'preview' && <PreviewScreen day={day} />}
          {(state === 'shift' || state === 'unavailable') && (
            <MyVisits
              day={day}
              limited={state === 'unavailable'}
              onInterrupt={() => openSheet('interrupt')}
              onIncident={() => openSheet('incident')}
              onShiftEnd={shiftEnd.request}
              shiftEndPending={shiftEnd.pending}
            />
          )}
          {state === 'finished' && <ShiftSummary day={day} />}
        </>
      )}
      <DoneToast />

      {search.sheet === 'transport' && state === 'preview' && (
        <TransportSheet engineer={day.engineer} onClose={closeSheet} />
      )}
      {search.sheet === 'interrupt' && state === 'shift' && current && (
        <InterruptSheet visit={current} dayDate={day.date} onClose={closeSheet} />
      )}
      {search.sheet === 'incident' && FEATURES.engineerIncident && state === 'shift' && current && (
        <IncidentSheet visit={current} engineer={day.engineer} onClose={closeSheet} />
      )}
      {search.sheet === 'shift_end' &&
        state === 'shift' &&
        (hasActiveVisit(day) || plannedLeft(day) > 0) && (
          <ShiftEndConfirm
            count={plannedLeft(day)}
            blockedBy={hasActiveVisit(day) ? current : null}
            onClose={closeSheet}
          />
        )}
      {search.sheet === 'unavailable' &&
        (state === 'shift' || (state === 'preview' && FEATURES.unavailableBeforeShift)) && (
          <UnavailableSheet day={day} beforeShift={state === 'preview'} onClose={closeSheet} />
        )}
      {search.point && !search.sheet && (
        <VisitSheet
          day={day}
          visitId={search.point}
          onClose={() => setSearch({ point: null })}
          onOpen={(id) => {
            // «назад» с карточки — на карту без шторки
            setSearch({ point: null });
            navigate(visitPath(id));
          }}
        />
      )}
    </EngineerPage>
  );
}
