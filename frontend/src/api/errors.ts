/** Единая ошибка API. `status = 0` — сеть (бэк не ответил). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Текст ошибки для пользователя: сообщение бэка или общий текст. */
export function errorMessage(error: unknown): string {
  return isApiError(error) ? error.message : 'Не удалось выполнить запрос. Повторите';
}

/** Текст исключения бэка (SQL, трассировка) — не для пользователя. */
const INTERNAL_TEXT = /psycopg|sqlalchemy|traceback|\bSQL\b|\[parameters:|StringDataRightTruncation|IntegrityError/i;
export const SERVER_FAILED = 'Ошибка на сервере: изменение не сохранено. Повторите позже или сообщите администратору';

/** Сообщение 5xx: внутренности бэка заменяем понятным текстом, сам текст — в консоль. */
function safeMessage(status: number, message: string): string {
  if (status < 500 || !INTERNAL_TEXT.test(message)) return message;
  console.error('Ошибка бэка', status, message);
  return SERVER_FAILED;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** У бэка три формата ошибок (FRONTEND_AGENT_GUIDE §2) — сводим их в один `ApiError`. */
export function toApiError(status: number, body: unknown): ApiError {
  const root: Json = isObject(body) ? body : {};
  const detail = root.detail;

  // middleware: {error:{…}} | HTTPException: {detail:{error:{…}}}
  const error = isObject(root.error)
    ? root.error
    : isObject(detail) && isObject(detail.error)
      ? detail.error
      : undefined;
  if (error) {
    return new ApiError(
      status,
      nonEmpty(error.code) ?? 'UNKNOWN',
      safeMessage(status, nonEmpty(error.message) ?? 'Не удалось выполнить запрос. Повторите'),
      error.details,
    );
  }

  // 422 ErrorResponse: {detail, code, context}
  if (typeof detail === 'string') {
    return new ApiError(
      status,
      nonEmpty(root.code) ?? 'VALIDATION_ERROR',
      safeMessage(status, detail),
      root.context,
    );
  }

  // 422 FastAPI HTTPValidationError: {detail: [...]}
  if (Array.isArray(detail)) {
    return new ApiError(status, 'VALIDATION_ERROR', 'Проверьте заполнение полей', detail);
  }

  return new ApiError(status, 'UNKNOWN', 'Не удалось выполнить запрос. Повторите');
}
