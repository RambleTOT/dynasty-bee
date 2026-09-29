/**
 * Живые обновления для вошедшего пользователя (docs/REALTIME.md): сокет открывается после входа,
 * закрывается при выходе. Событие → обновление запросов пачкой и, если нужно, тост с «Открыть».
 * Флаг `realtime` выключен (бэк ещё не сделал п. 38) — провайдер ничего не делает и код сокета
 * не грузится (session.ts — отдельный чанк); работает опрос.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { FEATURES } from '@/config';
import type { RealtimeStatus } from './client';
import { RealtimeContext } from './useRealtime';

export function RealtimeProvider({
  children,
  enabled = FEATURES.realtime,
}: {
  children: ReactNode;
  /** Для тестов; в приложении — флаг `realtime`. */
  enabled?: boolean;
}) {
  const { status: auth, role, user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!enabled || auth !== 'authenticated' || !role || !userId) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import('./session').then(({ startRealtime }) => {
      if (cancelled) return;
      stop = startRealtime({
        role,
        queryClient,
        navigate: (to) => navigateRef.current(to),
        onStatus: setStatus,
      });
    });
    return () => {
      cancelled = true;
      stop?.();
      setStatus('idle');
    };
  }, [enabled, auth, role, userId, queryClient]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}
