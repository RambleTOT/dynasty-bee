import { http, HttpResponse } from 'msw';
import type { LoginIn, LoginOut, UserOut } from '@/api/types';
import { API_URL } from '@/config';

/** Пароль мок-учёток (только VITE_USE_MOCKS=true). К паролю стенда отношения не имеет. */
const MOCK_PASSWORD = 'demo';
const ALL_REGIONS = ['east', 'south_east', 'south_center'];

const USERS = new Map<string, UserOut>([
  [
    'dispatcher',
    {
      id: 'mock-dispatcher',
      login: 'dispatcher',
      name: 'Диспетчер (моки)',
      role: 'dispatcher',
      region_ids: ALL_REGIONS,
    },
  ],
  [
    'operator',
    {
      id: 'mock-operator',
      login: 'operator',
      name: 'Оператор (моки)',
      role: 'operator',
      region_ids: ALL_REGIONS,
    },
  ],
  [
    'eng-east-01',
    {
      id: 'mock-eng-east-01',
      login: 'eng-east-01',
      name: 'Инженер E01 (моки)',
      role: 'engineer',
      region_ids: ['east'],
      engineer_id: 'E01',
    },
  ],
]);

// Токен мока — `mock.<логин>`: по нему /auth/me находит пользователя. Любой другой — «протух».
const TOKEN_PREFIX = 'mock.';

const unauthorized = (message: string) =>
  HttpResponse.json({ error: { code: 'UNAUTHORIZED', message } }, { status: 401 });

function userFromRequest(request: Request): UserOut | undefined {
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return token.startsWith(TOKEN_PREFIX) ? USERS.get(token.slice(TOKEN_PREFIX.length)) : undefined;
}

export const handlers = [
  http.post(`${API_URL}/auth/login`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as Partial<LoginIn> | null;
    const user = body?.login ? USERS.get(body.login) : undefined;
    if (!user || body?.password !== MOCK_PASSWORD) {
      return unauthorized('Неверный логин или пароль');
    }
    const response: LoginOut = {
      access_token: `${TOKEN_PREFIX}${user.login}`,
      token_type: 'bearer',
      user,
    };
    return HttpResponse.json(response);
  }),

  http.get(`${API_URL}/auth/me`, ({ request }) => {
    const user = userFromRequest(request);
    return user ? HttpResponse.json(user) : unauthorized('Требуется вход');
  }),

  http.post(`${API_URL}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
];
