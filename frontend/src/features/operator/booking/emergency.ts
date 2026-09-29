/** Авария от оператора → диспетчеру (FRONTEND_SPEC §8.3.9, ⏳ 9.1). */
import type { UrgentRequestIn } from '@/api/types';
import { BK } from '@/lib/dictionaries';
import type { Transport } from '@/lib/statuses';
import { nowMsk, toMin } from '@/lib/time';

/** Длительность аварии на адресе по нормативу (D-07). */
export const EMERGENCY_DURATION_MIN = 80;

/**
 * Окно аварии ставит бэк по часам дня (⏳ 9.1), но в `RequestIn` оно обязательно — шлём заглушку
 * из ТЗ: «сейчас» браузера и 22:00. Позже 22:00 — до конца суток, чтобы окно не вывернулось [Д].
 */
const PLACEHOLDER_END = '22:00';
const DAY_END = '23:59';

export const emergencyWindowEnd = (now: string) =>
  toMin(now) < toMin(PLACEHOLDER_END) ? PLACEHOLDER_END : DAY_END;

export interface EmergencyFields {
  region: string;
  typeHd: string;
  address: string;
  transport: Transport | null;
  comment: string;
  /** Точка адреса (подсказка, карта): без координат бэк может не найти адрес (BACKEND_REQUESTS п. 46). */
  point?: { lat: number; lon: number } | null;
}

export interface EmergencyInput {
  regionId: string;
  comment?: string;
  request: UrgentRequestIn;
}

/** Вход `applyOperatorEmergency`: без plan_id и event_time — план и часы бэк берёт сам. */
export function emergencyInput(
  fields: EmergencyFields,
  now: string = nowMsk(),
  id = `U-${Date.now().toString(36).toUpperCase()}`,
): EmergencyInput {
  return {
    regionId: fields.region,
    comment: fields.comment.trim() || undefined,
    request: {
      id,
      address: fields.address.trim(),
      duration_minutes: EMERGENCY_DURATION_MIN,
      window_start: now,
      window_end: emergencyWindowEnd(now),
      priority: 'urgent',
      required_skill: 'emergency',
      required_transport: fields.transport ?? 'car',
      type_bk: BK.emergency,
      type_hd: fields.typeHd,
      source: 'operator',
      ...(fields.point ? { latitude: fields.point.lat, longitude: fields.point.lon } : {}),
    },
  };
}
