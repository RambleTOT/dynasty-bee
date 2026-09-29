/**
 * DS-03 «День»: шапка по состоянию плана, баннер предложения, карта / таймлайн, правая панель
 * и все дроверы и модалки дня (FRONTEND_SPEC §8.2). Фильтры и открытые панели — в адресе.
 */
import { CalendarX2, ClipboardList, GanttChart, Map as MapIcon, MoreHorizontal, Plus, Route, Upload, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '@/api/errors';
import type { DispatcherEvent } from '@/api/events';
import { buildFeed } from '@/adapters/feed';
import { useAuth } from '@/auth/useAuth';
import { useSearchState } from '@/hooks/useSearchState';
import { countOf, formatDayTitle, PL_REQUEST } from '@/lib/format';
import { notify } from '@/lib/notify';
import { regionLabel } from '@/lib/dictionaries';
import { useRegions } from '@/hooks/useRegions';
import { anyRegionEnabled, isRegionSlug } from '@/lib/regions';
import { isRegionId, REGIONS, type RegionId } from '@/lib/statuses';
import { addDays, todayMsk } from '@/lib/time';
import {
  ActionMenu,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  SegmentedControl,
  Skeleton,
  Spinner,
} from '@/ui';
import { rememberLastDay } from '../lastDay';
import { CompareModal } from './CompareModal';
import { ComparePanel } from './ComparePanel';
import { DayHeader } from './DayHeader';
import { DayMap, type MapHighlight } from './DayMap';
import { CLOSED_PANELS, daySearch, type DayTab, type DayView } from './daySearch';
import { EngineerChips } from './EngineerChips';
import { EventModal } from './EventModal';
import { FeedPanel } from './FeedPanel';
import { ProposalBanner } from './ProposalBanner';
import { ProposalDrawer } from './ProposalDrawer';
import { ReassignModal } from './ReassignModal';
import { RequestDrawer } from './RequestDrawer';
import { RosterDrawer } from './RosterDrawer';
import { SummaryModal } from './SummaryModal';
import { Timeline } from './Timeline';
import { UnassignedPanel } from './UnassignedPanel';
import { useCompareData } from './useCompareData';
import { useDayActions } from './useDayActions';
import { useDayData } from './useDayData';
import { useDraftTimeline, type DraftRequest } from './useDraftTimeline';
import { useResend } from './useResend';
import { VersionsPanel } from './VersionsPanel';
import styles from './DayPage.module.css';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;

function defaultRegion(regionIds: readonly string[] | undefined): RegionId {
  const first = regionIds?.find(isRegionId);
  return first ?? REGIONS[0];
}

export default function DayPage() {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [search, setSearch] = useSearchState(daySearch);

  const date = params.date && YMD.test(params.date) ? params.date : todayMsk();
  // участок кейса; с §14 — любой id участка (свои участки заводит диспетчер). Пока справочник
  // участков не пришёл, id из адреса не отбрасываем: иначе ссылка на день своего участка
  // перепишется на участок по умолчанию.
  const { query: regionsQuery } = useRegions();
  const customRegion = anyRegionEnabled() || regionsQuery.isPending;
  const knownRegion =
    search.region && (isRegionId(search.region) || (customRegion && isRegionSlug(search.region)));
  const regionId: string = knownRegion && search.region ? search.region : defaultRegion(user?.region_ids);
  const clock = search.clock && CLOCK.test(search.clock) ? search.clock.padStart(5, '0') : null;

  // регион — всегда в адресе: ссылку на день можно отправить коллеге
  useEffect(() => {
    if (search.region !== regionId) setSearch({ region: regionId });
  }, [search.region, regionId, setSearch]);

  useEffect(() => {
    rememberLastDay(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  const data = useDayData(date, regionId, clock);
  const { model, chain } = data;
  const actions = useDayActions(date);
  const compareData = useCompareData(model);
  const feed = useMemo(() => (model && chain ? buildFeed({ chain, model }) : []), [model, chain]);
  const filters = useMemo(() => ({ status: search.status, type: search.type }), [search.status, search.type]);
  const [highlight, setHighlight] = useState<MapHighlight | null>(null);
  // черновик на таймлайне: предложение, сравнение версий или ручное переназначение
  const [draftRequest, setDraftRequest] = useState<DraftRequest | null>(null);
  const draftView = useDraftTimeline(draftRequest, {
    date,
    region: data.region,
    scenario: data.scenario,
    model,
    clock,
  });
  // подсветка и черновик — только для дня, где их открыли
  useEffect(() => {
    setHighlight(null);
    setDraftRequest(null);
  }, [date, regionId]);
  // тело события по плану предложения: для повтора при STALE_PROPOSAL (§6.4, п. 8)
  const sentEvents = useRef(new Map<string, DispatcherEvent>());
  const resend = useResend({
    headPlanId: model?.planId ?? null,
    chain,
    actions,
    sentEvent: (planId) => sentEvents.current.get(planId) ?? null,
  });
  const resendProposal = async (planId: string) => {
    try {
      const next = await resend.run(planId);
      sentEvents.current.set(next.planId, next.event);
      setHighlight(null);
      setDraftRequest(null);
      setSearch({ proposal: next.planId, against: null });
    } catch (error) {
      notify(errorMessage(error), 'error');
    }
  };

  // Карточка заявки поверх предложения — отдельным шагом истории: «Назад» браузера, «К предложению»
  // и ✕ возвращают к предложению. Открыли по ссылке (шага нет) — просто закрываем.
  const cardPushed = useRef(false);
  useEffect(() => {
    if (!search.pin) cardPushed.current = false;
  }, [search.pin]);
  const openCardOverProposal = (id: string) => {
    const next = new URLSearchParams(location.search);
    next.set('pin', id);
    cardPushed.current = true;
    navigate({ search: `?${next.toString()}` });
  };
  const closeCard = () => {
    if (cardPushed.current) {
      cardPushed.current = false;
      navigate(-1);
    } else {
      setSearch({ pin: null });
    }
  };

  const goDate = (delta: number) => {
    const next = new URLSearchParams();
    next.set('region', regionId);
    if (search.view !== 'map') next.set('view', search.view);
    if (search.tab !== 'cmp') next.set('tab', search.tab);
    if (clock) next.set('clock', clock);
    navigate({ pathname: `/dispatcher/day/${addDays(date, delta)}`, search: `?${next}` });
  };

  const openRequest = (id: string) => {
    const request = model?.requestById.get(id);
    if (request && !request.visit) setSearch({ tab: 'un', focus: id, request: null });
    else setSearch({ request: id });
  };
  const openUnassigned = (id: string) => setSearch({ tab: 'un', focus: id });
  const openProposal = (planId: string) => {
    setHighlight(null);
    setDraftRequest(null);
    setSearch({ proposal: planId, against: null });
  };

  const needCount = feed.filter((row) => row.needsDecision).length;
  const planState = model?.planState ?? data.region?.plan_state ?? 'none';
  const isToday = date === todayMsk();

  // число заявок дня региона — всегда в шапке; снятые (отмена, перенос) не считаем
  let meta: string | null = null;
  if (model) {
    const total = model.requests.filter((r) => r.status !== 'cancelled' && r.status !== 'rescheduled').length;
    const count = countOf(total, PL_REQUEST);
    if (planState === 'none') meta = `${count} · плана нет`;
    else if (planState === 'draft') meta = `${count} · план не опубликован`;
    else meta = `${count} · версия ${model.version}${isToday || model.clock ? ` · сейчас ${model.now}` : ''}`;
  }

  const rosterButton = (
    <Button variant="tertiary" icon={Users} onClick={() => setSearch({ roster: '1', add: null })}>
      Состав и ресурсы
    </Button>
  );
  let headerActions = null;
  if (model && planState === 'none') {
    headerActions = (
      <>
        {rosterButton}
        <Button
          variant="primary"
          icon={Route}
          loading={actions.buildPlan.isPending}
          onClick={() => actions.buildPlan.mutate(model.scenarioId)}
        >
          {actions.buildPlan.isPending ? 'Строим план…' : 'Построить план'}
        </Button>
      </>
    );
  } else if (model && planState === 'draft') {
    headerActions = (
      <>
        {rosterButton}
        <Button
          variant="primary"
          loading={actions.startDay.isPending}
          onClick={() => model.planId && actions.startDay.mutate(model.planId)}
        >
          Начать рабочий день
        </Button>
      </>
    );
  } else if (model) {
    headerActions = (
      <>
        <Button variant="tertiary" icon={ClipboardList} onClick={() => setSearch({ summary: '1' })}>
          Итоги дня
        </Button>
        <ActionMenu
          trigger={({ toggle, open, id }) => (
            <IconButton
              icon={MoreHorizontal}
              label="Ещё"
              variant="tertiary"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={id}
              onClick={toggle}
            />
          )}
          items={[{ label: 'Состав и ресурсы', onSelect: () => setSearch({ roster: '1', add: null }) }]}
        />
        <Button variant="primary" icon={Plus} onClick={() => setSearch({ event: 'urgent', order: null })}>
          Добавить событие
        </Button>
      </>
    );
  }

  const tabs: { value: DayTab; label: string; count?: number | null }[] = [
    { value: 'cmp', label: 'Сравнение' },
    { value: 'un', label: 'Неназначенные', count: model?.plan ? model.unassigned.length || null : null },
    { value: 'feed', label: 'Лента', count: needCount || null },
    { value: 'ver', label: 'Версии' },
  ];

  let body;
  if (data.loading) {
    body = (
      <div className={styles.content}>
        <div className={styles.left}>
          <Skeleton height={40} radius="var(--radius-pill)" />
          <div className={styles.stage}>
            <div className={styles.loading}>
              <Spinner size={28} label="Загружаем день" />
            </div>
          </div>
        </div>
        <aside className={styles.panel}>
          <Skeleton height={32} radius="var(--radius-pill)" />
          <Skeleton height={220} />
          <Skeleton height={160} />
        </aside>
      </div>
    );
  } else if (data.empty) {
    body = (
      <div className={styles.center}>
        <EmptyState
          icon={CalendarX2}
          title={`На ${formatDayTitle(date).toLowerCase()} в регионе «${regionLabel(regionId)}» заявок нет`}
          action={
            <Button variant="secondary" icon={Upload} onClick={() => navigate(`/dispatcher?modal=import&date=${date}`)}>
              Загрузить CSV
            </Button>
          }
        >
          Загрузите CSV или дождитесь записей оператора
        </EmptyState>
      </div>
    );
  } else if (!model) {
    body = (
      <div className={styles.center}>
        <ErrorState message="Не удалось связаться с сервером." onRetry={data.refetch} retrying={data.fetching} />
      </div>
    );
  } else {
    body = (
      <div className={styles.content}>
        <div className={styles.left}>
          <div className={styles.toolbar}>
            <SegmentedControl<DayView>
              value={search.view}
              onChange={(view) => {
                setHighlight(null);
                setDraftRequest(null);
                setSearch({ view });
              }}
              label="Вид"
              options={[
                { value: 'map', label: 'Карта', icon: MapIcon },
                { value: 'timeline', label: 'Таймлайн', icon: GanttChart },
              ]}
            />
            <EngineerChips model={model} brigade={search.brigade} onSelect={(brigade) => setSearch({ brigade })} />
          </div>
          <div className={styles.stage}>
            {search.view === 'map' ? (
              <DayMap
                model={model}
                geojson={data.geojson}
                filters={filters}
                brigade={search.brigade}
                selectedRequest={search.pin ?? search.request ?? search.focus}
                highlight={highlight}
                onOpenRequest={(id) => setSearch({ pin: id })}
              />
            ) : (
              <Timeline
                model={draftView.draft?.model ?? model}
                filters={filters}
                brigade={search.brigade}
                selectedRequest={search.request ?? search.focus}
                onOpenRequest={openRequest}
                onOpenUnassigned={openUnassigned}
                draft={draftRequest ? (draftView.draft?.overlay ?? null) : null}
              />
            )}
            {draftRequest && search.view === 'timeline' && (
              <div className={styles.highlightBar}>
                {draftView.loading && <Spinner size={16} label="Готовим черновик" />}
                {draftView.failed
                  ? 'Не удалось загрузить черновик'
                  : `${draftRequest.caption}. Изменённые бригады — ярко, прежнее место визита — пунктиром`}
                {draftRequest.kind === 'plan' && draftRequest.proposalId && (
                  <Button
                    variant="inverse"
                    size="sm"
                    onClick={() => openProposal((draftRequest as { proposalId: string }).proposalId)}
                  >
                    К предложению
                  </Button>
                )}
                {draftRequest.kind === 'reassign' ? (
                  <Button variant="inverse" size="sm" onClick={() => setDraftRequest(null)}>
                    К переназначению
                  </Button>
                ) : (
                  <Button variant="inverse" size="sm" onClick={() => setDraftRequest(null)}>
                    Скрыть
                  </Button>
                )}
              </div>
            )}
            {highlight && (
              <div className={styles.highlightBar}>
                Изменённые маршруты подсвечены, прежние — серым пунктиром
                {highlight.planId && (
                  <Button variant="inverse" size="sm" onClick={() => openProposal(highlight.planId as string)}>
                    К предложению
                  </Button>
                )}
                <Button variant="inverse" size="sm" onClick={() => setHighlight(null)}>
                  Скрыть
                </Button>
              </div>
            )}
            {actions.buildPlan.isPending && (
              <div className={styles.building}>
                <Spinner size={20} label="Строим план" />
                Строим план…
              </div>
            )}
          </div>
        </div>
        <aside className={styles.panel}>
          <SegmentedControl<DayTab>
            size="sm"
            fullWidth
            value={search.tab}
            onChange={(tab) => setSearch({ tab, focus: null })}
            label="Панель дня"
            options={tabs}
          />
          <div className={styles.panelBody}>
            {search.tab === 'cmp' && compareData.compare && (
              <ComparePanel
                compare={compareData.compare}
                loading={compareData.loading}
                onFullscreen={() => setSearch({ compare: '1' })}
              />
            )}
            {search.tab === 'un' && (
              <UnassignedPanel
                model={model}
                focus={search.focus}
                canEdit={planState === 'applied'}
                onReassign={(id) => setSearch({ reassign: id, base: null })}
                onAddEngineer={() => setSearch({ roster: '1', add: '1' })}
              />
            )}
            {search.tab === 'feed' && (
              <FeedPanel
                rows={feed}
                onOpenProposal={openProposal}
                onResend={(planId) => void resendProposal(planId)}
                canResend={resend.can}
                resendingId={resend.pendingId}
              />
            )}
            {search.tab === 'ver' && chain && (
              <VersionsPanel
                chain={chain}
                model={model}
                feed={feed}
                onCompare={(planId) => setSearch({ proposal: planId, against: model.planId })}
              />
            )}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <DayHeader
        date={date}
        regionId={regionId}
        model={model}
        meta={meta}
        status={search.status}
        type={search.type}
        onDate={goDate}
        onRegion={(region) => setSearch({ ...CLOSED_PANELS, region, brigade: null, status: null, type: null })}
        onStatus={(status) => setSearch({ status })}
        onType={(type) => setSearch({ type })}
        actions={headerActions}
      />
      {model && chain && (model.pendingProposals.length > 0 || chain.staleProposals.length > 0) && (
        <ProposalBanner
          model={model}
          chain={chain}
          resend={resend}
          onOpen={openProposal}
          onResend={(planId) => void resendProposal(planId)}
        />
      )}
      {body}

      {model && chain && (
        <>
          {search.request && (
            <RequestDrawer
              model={model}
              requestId={search.request}
              onClose={() => setSearch({ request: null })}
              onCancel={(orderId) => setSearch({ request: null, event: 'cancel', order: orderId })}
              onReassign={(orderId) => setSearch({ request: null, reassign: orderId, base: null })}
            />
          )}
          {search.event && (
            <EventModal
              tab={search.event}
              model={model}
              orderId={search.order}
              actions={actions}
              onTab={(event) => setSearch({ event })}
              onRegion={(region) => setSearch({ region, order: null, brigade: null, status: null, type: null })}
              onClose={() => setSearch({ event: null, order: null })}
              onProposal={(planId, event) => {
                sentEvents.current.set(planId, event);
                setSearch({ event: null, order: null, proposal: planId, against: null, tab: 'feed' });
              }}
            />
          )}
          {search.proposal && (
            <ProposalDrawer
              key={`${search.proposal}:${search.against ?? ''}`}
              planId={search.proposal}
              against={search.against}
              model={model}
              chain={chain}
              actions={actions}
              resend={resend}
              onResent={(planId, event) => {
                sentEvents.current.set(planId, event);
                setSearch((current) =>
                  current.proposal === search.proposal ? { proposal: planId, against: null } : {},
                );
              }}
              onShowOnMap={(next) => {
                setDraftRequest(null);
                setHighlight(next);
                setSearch({ proposal: null, against: null, view: 'map' });
              }}
              onShowOnTimeline={(next) => {
                setHighlight(null);
                setDraftRequest(next);
                setSearch({ proposal: null, against: null, view: 'timeline' });
              }}
              onEditManually={(orderId, basePlanId) =>
                setSearch({ proposal: null, against: null, reassign: orderId, base: basePlanId })
              }
              onOpenRequest={openCardOverProposal}
              onDone={(planId) =>
                setSearch((current) =>
                  current.proposal === planId ? { proposal: null, against: null } : {},
                )
              }
              onClose={() => setSearch({ proposal: null, against: null })}
            />
          )}
          {/* после предложения: карточка из него — поверх */}
          {search.pin && !search.request && (
            <RequestDrawer
              as="dialog"
              model={model}
              requestId={search.pin}
              onClose={closeCard}
              onBack={search.proposal ? closeCard : undefined}
              onCancel={(orderId) => setSearch({ pin: null, event: 'cancel', order: orderId })}
              onReassign={(orderId) => setSearch({ pin: null, reassign: orderId, base: null })}
              onShowInList={(orderId) => setSearch({ pin: null, tab: 'un', focus: orderId })}
            />
          )}
          {search.compare && (
            <CompareModal model={model} chain={chain} onClose={() => setSearch({ compare: null })} />
          )}
          {search.reassign && (
            <ReassignModal
              requestId={search.reassign}
              basePlanId={search.base}
              model={model}
              actions={actions}
              hidden={draftRequest?.kind === 'reassign'}
              onPreview={(next) => {
                setHighlight(null);
                setDraftRequest(next);
                setSearch({ view: 'timeline' });
              }}
              onClose={() => {
                if (draftRequest?.kind === 'reassign') setDraftRequest(null);
                setSearch({ reassign: null, base: null });
              }}
            />
          )}
          {search.roster && (
            <RosterDrawer
              model={model}
              withAddForm={search.add === '1'}
              actions={actions}
              onProposal={(planId) => setSearch({ roster: null, add: null, proposal: planId, against: null })}
              onClose={() => setSearch({ roster: null, add: null })}
            />
          )}
          {search.summary && (
            <SummaryModal model={model} chain={chain} onClose={() => setSearch({ summary: null })} />
          )}
        </>
      )}
    </div>
  );
}
