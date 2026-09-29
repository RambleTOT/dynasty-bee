/**
 * Баннер предложения (DS-03): «Есть предложение после события «…»: изменилось N назначений».
 * Ждущих нет, но есть устаревшие (считались от прежней версии, BACKEND_REQUESTS п. 48) —
 * баннер предлагает пересчитать первое из них на действующей версии.
 */
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, GitCompareArrows, History, RefreshCw } from 'lucide-react';
import { getPlanDiff } from '@/api/planning';
import { queryKeys } from '@/api/queryKeys';
import type { DayChain } from '@/adapters/dayChain';
import type { DayModel } from '@/adapters/dayModel';
import { changedAssignments, eventTimeOf, eventTitle } from '@/adapters/proposal';
import { plural, timeOfIso } from '@/lib/format';
import { Button, DarkBanner } from '@/ui';
import type { Resend } from './useResend';

const PL_ASSIGNMENT = ['назначение', 'назначения', 'назначений'] as const;

export function ProposalBanner({
  model,
  chain,
  resend,
  onOpen,
  onResend,
}: {
  model: DayModel;
  chain: DayChain;
  resend: Resend;
  onOpen: (planId: string) => void;
  onResend: (planId: string) => void;
}) {
  const proposal = model.pendingProposals[0];
  const against = model.planId;
  const diff = useQuery({
    queryKey: queryKeys.diff(proposal?.plan_id ?? '-', against ?? '-'),
    queryFn: ({ signal }) => getPlanDiff(proposal.plan_id, against as string, signal),
    enabled: Boolean(proposal && against),
    staleTime: Infinity,
    retry: false,
  });

  if (!proposal) {
    const stale = chain.staleProposals[0];
    if (!stale) return null;
    const title = eventTitle(model, stale.event.event_type, stale.event.payload);
    const time = eventTimeOf(stale.event) ?? timeOfIso(stale.event.created_at);
    const more = chain.staleProposals.length - 1;
    return (
      <DarkBanner
        icon={History}
        aside={`${time ? `${time} · ` : ''}устарело${more > 0 ? ` · ещё ${more}` : ''}`}
        action={
          resend.can(stale.planId) ? (
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={resend.pendingId === stale.planId}
              onClick={() => onResend(stale.planId)}
            >
              Пересчитать
            </Button>
          ) : (
            <Button variant="secondary" size="sm" iconRight={ArrowRight} onClick={() => onOpen(stale.planId)}>
              Открыть
            </Button>
          )
        }
      >
        Предложение после события «{title}» считалось от версии {stale.baseVersion ?? '—'}, а
        действует версия {model.version}: пересчитайте его
      </DarkBanner>
    );
  }

  const event = chain.events.find((e) => e.event_id === proposal.event_id);
  const title = event
    ? eventTitle(model, event.event_type, event.payload)
    : (proposal.event_type ?? proposal.headline ?? 'событие');
  const n = diff.data ? changedAssignments(diff.data.summary) : null;
  const more = model.pendingProposals.length - 1 + chain.staleProposals.length;
  // время события по часам дня, как в ленте; нет — время расчёта
  const time = (event ? eventTimeOf(event) : null) ?? timeOfIso(proposal.created_at ?? event?.created_at);

  return (
    <DarkBanner
      icon={GitCompareArrows}
      aside={`${time ? `${time} · ` : ''}ждёт решения${more > 0 ? ` · ещё ${more}` : ''}`}
      action={
        <Button variant="secondary" size="sm" iconRight={ArrowRight} onClick={() => onOpen(proposal.plan_id)}>
          Открыть
        </Button>
      }
    >
      Есть предложение после события «{title}»
      {n != null ? `: изменилось ${n} ${plural(n, PL_ASSIGNMENT)}` : ''}
    </DarkBanner>
  );
}
