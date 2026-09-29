import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePlan } from '@/adapters/__fixtures__/day';
import { overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import type { DayChain } from '@/adapters/dayChain';
import { ApiError } from '@/api/errors';
import type { DispatcherEvent } from '@/api/events';
import { applyPlan, getPlan, getPlanDiff } from '@/api/planning';
import type { PlanDiffResponse } from '@/api/types';
import { dismissAll } from '@/lib/notify';
import { renderDay, withDayActions } from '@/test/dispatcherDay';
import { ProposalDrawer } from './ProposalDrawer';
import type { Resend } from './useResend';

vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  getPlan: vi.fn(),
  getPlanDiff: vi.fn(),
  applyPlan: vi.fn(),
}));

afterEach(() => {
  act(() => dismissAll());
  vi.clearAllMocks();
});

const diff: PlanDiffResponse = {
  base_plan_id: 'P0',
  new_plan_id: 'P3',
  summary: {
    reassigned: 0,
    reordered: 0,
    time_shifted: 0,
    added: 1,
    removed: 0,
    newly_unassigned: 0,
    newly_assigned: 0,
    untouched: 12,
  },
  changes: [],
  engineers: [],
  headline: 'Авария добавлена',
};

const chain = (statuses: [string, string][]): DayChain => ({
  headPlanId: 'P1',
  version: 4,
  versions: [
    { planId: 'P1', version: 4, createdAt: null, status: 'applied', engineersUsed: null, plannedCount: null, distanceKm: null, event: null, via: null },
    { planId: 'P0', version: 3, createdAt: null, status: 'superseded', engineersUsed: null, plannedCount: null, distanceKm: null, event: null, via: null },
  ],
  pendingProposals: [],
  staleProposals: [],
  consumed: new Map(),
  cancelledIds: new Set(),
  events: [],
  planStatus: new Map(statuses),
});

const EVENT: DispatcherEvent = { type: 'engineer_available', plan_id: 'P1', engineer_id: 'e2' };

function renderDrawer(parent: string, resend: Partial<Resend> = {}) {
  vi.mocked(getPlan).mockResolvedValue(
    makePlan({ plan_id: 'P3', parent_plan_id: parent, status: 'proposed' }),
  );
  vi.mocked(getPlanDiff).mockResolvedValue(diff);
  const run = vi.fn(async () => ({ planId: 'P9', event: EVENT }));
  const onResent = vi.fn();
  const onClose = vi.fn();
  renderDay(
    withDayActions('2026-09-29', (actions) => (
      <ProposalDrawer
        planId="P3"
        against={null}
        model={overlayModel()}
        chain={chain([['P3', 'proposed']])}
        actions={actions}
        resend={{ can: () => true, run, pendingId: null, ...resend }}
        onResent={onResent}
        onShowOnMap={vi.fn()}
        onShowOnTimeline={vi.fn()}
        onEditManually={vi.fn()}
        onOpenRequest={vi.fn()}
        onDone={onClose}
        onClose={onClose}
      />
    )),
  );
  return { run, onResent, onClose };
}

describe('DS-07 «Предложение» от прежней версии', () => {
  it('принять нельзя: «Пересчитать» — то же событие на действующей версии, открыть новое', async () => {
    const { run, onResent } = renderDrawer('P0');
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/предложение считалось от версии 3, а действует версия 4/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Принять изменения' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Отклонить' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Пересчитать' }));
    await waitFor(() => expect(onResent).toHaveBeenCalledWith('P9', EVENT));
    expect(run).toHaveBeenCalledWith('P3');
  });

  it('событие не собрать — только «Отклонить» и подсказка добавить событие заново', async () => {
    renderDrawer('P0', { can: () => false });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Отклоните его и добавьте событие заново/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Пересчитать' })).toBeNull();
  });

  it('версия сменилась, пока окно открыто: 409 STALE_PROPOSAL → «Пересчитать», окно не закрывается', async () => {
    vi.mocked(applyPlan).mockRejectedValue(
      new ApiError(409, 'STALE_PROPOSAL', 'Предложение устарело: действующая версия изменилась, пересчитайте'),
    );
    const { onClose } = renderDrawer('P1');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Принять изменения' }));
    expect(await within(dialog).findByRole('button', { name: 'Пересчитать' })).toBeInTheDocument();
    expect(within(dialog).getByText(/План уже изменился/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
