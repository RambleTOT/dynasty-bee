/**
 * Профиль из токена. Бэк 28.09 пускает инженера только на `/engineers/me*`: `/auth/me` отвечает ему 403
 * (docs/API_NOTES.md), поэтому после перезагрузки профиль берём из claims JWT. Подпись не проверяем —
 * это только маршрутизация интерфейса, права проверяет бэк.
 */
import type { UserOut } from '@/api/types';

function decodeBase64Url(part: string): string {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function userFromToken(token: string | null, now: number = Date.now()): UserOut | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= now) return null;
    if (typeof claims.role !== 'string' || !claims.role) return null;
    return {
      id: String(claims.sub ?? ''),
      login: typeof claims.login === 'string' ? claims.login : '',
      name: typeof claims.name === 'string' ? claims.name : '',
      role: claims.role,
      region_ids: Array.isArray(claims.region_ids) ? claims.region_ids.map(String) : [],
      engineer_id: typeof claims.engineer_id === 'string' ? claims.engineer_id : null,
    };
  } catch {
    return null;
  }
}
