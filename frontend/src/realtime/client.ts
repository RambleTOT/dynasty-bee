/**
 * Клиент живых обновлений (docs/REALTIME.md): разовый билет по REST → WebSocket → события.
 * - Переподключение с растущей паузой (REALTIME.backoffMs, ±20 %), новый билет каждый раз.
 * - Номер последнего события (`seq`) уходит в `since`: сервер повторит пропущенное или пришлёт
 *   `resync` — тогда страница обновляет всё.
 * - Тишина дольше REALTIME.heartbeatTimeoutMs — соединение считаем мёртвым.
 * - У бэка нет живых обновлений (билет — 404/405/501) или роли они не положены (4403) —
 *   `unavailable`: остаётся обычный опрос, до перезагрузки не пробуем.
 * Сам по себе клиент ничего не знает о React и запросах: что делать с событием, решает effects.ts.
 */
import { isApiError } from '@/api/errors';
import { REALTIME } from '@/config';
import { parseServerMessage, type RealtimeEvent } from './protocol';

export type RealtimeStatus =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'unavailable' | 'closed';

/** Нужная часть WebSocket: в тестах — поддельный сокет. */
export interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

export interface RealtimeClientOptions {
  /** Разовый билет для подключения (`POST /realtime/ticket`). */
  getTicket: () => Promise<string>;
  /** Адрес сокета по билету и номеру последнего полученного события. */
  url: (ticket: string, since: number | null) => string;
  onEvent: (event: RealtimeEvent) => void;
  /** События пропущены и не повторятся — обновить всё. */
  onResync: () => void;
  onStatus?: (status: RealtimeStatus) => void;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
}

/** Коды закрытия от сервера (BACKEND_REQUESTS п. 38). */
export const CLOSE = {
  normal: 1000,
  /** Билет просрочен или чужой — берём новый. */
  unauthorized: 4401,
  /** Роли живые обновления не положены. */
  forbidden: 4403,
  /** Наш сторож: сервер молчит дольше REALTIME.heartbeatTimeoutMs. */
  heartbeat: 4000,
} as const;

/** Ответ на запрос билета, после которого пробовать снова бессмысленно: ручки нет. */
function isMissingEndpoint(error: unknown): boolean {
  return isApiError(error) && [404, 405, 501].includes(error.status);
}

export class RealtimeClient {
  private socket: SocketLike | null = null;
  private status: RealtimeStatus = 'idle';
  private lastSeq: number | null = null;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: RealtimeClientOptions) {}

  get currentStatus(): RealtimeStatus {
    return this.status;
  }

  get lastEventSeq(): number | null {
    return this.lastSeq;
  }

  start(): void {
    this.stopped = false;
    if (this.status === 'idle' || this.status === 'closed') void this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    const socket = this.socket;
    this.socket = null;
    socket?.close(CLOSE.normal, 'stop');
    this.setStatus('closed');
  }

  /** Сеть вернулась — не ждём паузу. */
  reconnectNow(): void {
    if (this.stopped || this.status !== 'reconnecting' || this.socket) return;
    clearTimeout(this.reconnectTimer);
    void this.connect();
  }

  private setStatus(status: RealtimeStatus) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  private async connect(): Promise<void> {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: string;
    try {
      ticket = await this.options.getTicket();
    } catch (error) {
      if (this.stopped) return;
      if (isMissingEndpoint(error)) {
        this.setStatus('unavailable');
        return;
      }
      // 401 — сессия кончилась: выход обработает AuthProvider, провайдер остановит клиент
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const create =
      this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    let socket: SocketLike;
    try {
      socket = create(this.options.url(ticket, this.lastSeq));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => this.armWatchdog();
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => undefined; // следом придёт onclose
    socket.onclose = (event) => this.handleClose(socket, event.code);
  }

  private handleMessage(data: unknown) {
    this.armWatchdog();
    const message = parseServerMessage(data);
    if (!message) return;
    switch (message.type) {
      case 'hello': {
        this.attempt = 0;
        // номер на сервере меньше нашего — сервер перезапускался и считает заново; бэк при этом
        // отвечает resumed: true (п. 38), но новые события иначе отбросили бы как повторы
        const restarted = this.lastSeq !== null && message.seq < this.lastSeq;
        // сервер не повторил пропущенное (буфер кончился, сервер перезапускался) — обновляем всё
        if (restarted || (this.lastSeq !== null && !message.resumed && message.seq !== this.lastSeq)) {
          this.options.onResync();
        }
        if (this.lastSeq === null || !message.resumed || restarted) this.lastSeq = message.seq;
        this.setStatus('open');
        break;
      }
      case 'event':
        if (this.lastSeq !== null && message.event.seq <= this.lastSeq) return; // повтор
        this.lastSeq = message.event.seq;
        this.options.onEvent(message.event);
        break;
      case 'resync':
        this.options.onResync();
        break;
      case 'ping':
      case 'error':
        break;
    }
  }

  private handleClose(socket: SocketLike, code: number) {
    if (socket !== this.socket) return; // старый сокет после stop или переподключения
    this.socket = null;
    clearTimeout(this.watchdog);
    if (this.stopped) {
      this.setStatus('closed');
      return;
    }
    if (code === CLOSE.forbidden) {
      this.setStatus('unavailable');
      return;
    }
    this.scheduleReconnect();
  }

  private armWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.socket?.close(CLOSE.heartbeat, 'heartbeat');
    }, REALTIME.heartbeatTimeoutMs);
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const steps = REALTIME.backoffMs;
    const base = steps[Math.min(this.attempt, steps.length - 1)];
    const jitter = 1 + ((this.options.random ?? Math.random)() * 0.4 - 0.2);
    this.attempt += 1;
    this.setStatus('reconnecting');
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), Math.round(base * jitter));
  }
}
