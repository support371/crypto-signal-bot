/**
 * src/lib/streamClient.ts
 *
 * Canonical WebSocket abstraction with:
 *  - Configurable reconnect with exponential backoff
 *  - Connection-state tracking (connecting | connected | disconnected | error)
 *  - Typed message dispatch
 *  - Auto-ping keepalive
 */
import { getBackendWebSocketUrl } from "@/lib/apiClient";

export type WsConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface StreamClientOptions {
  /** WebSocket path override — defaults to /ws */
  path?: string;
  /** Initial reconnect delay in ms (default 1 000) */
  initialDelay?: number;
  /** Maximum reconnect delay in ms (default 30 000) */
  maxDelay?: number;
  /** Backoff multiplier (default 1.5) */
  backoffFactor?: number;
  /** Max reconnect attempts before giving up (0 = unlimited) */
  maxAttempts?: number;
  /** Keepalive ping interval in ms (default 25 000, 0 = disabled) */
  pingInterval?: number;
  /** Called on every inbound message */
  onMessage?: (data: unknown) => void;
  /** Called when connection state changes */
  onStateChange?: (state: WsConnectionState) => void;
  /** Called on any error event */
  onError?: (event: Event) => void;
}

export class StreamClient {
  private ws: WebSocket | null = null;
  private _state: WsConnectionState = "idle";
  private _attempts = 0;
  private _delay: number;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _closed = false;

  private readonly opts: Required<StreamClientOptions>;

  constructor(opts: StreamClientOptions = {}) {
    this.opts = {
      path: opts.path ?? "/ws",
      initialDelay: opts.initialDelay ?? 1_000,
      maxDelay: opts.maxDelay ?? 30_000,
      backoffFactor: opts.backoffFactor ?? 1.5,
      maxAttempts: opts.maxAttempts ?? 0,
      pingInterval: opts.pingInterval ?? 25_000,
      onMessage: opts.onMessage ?? (() => {}),
      onStateChange: opts.onStateChange ?? (() => {}),
      onError: opts.onError ?? (() => {}),
    };
    this._delay = this.opts.initialDelay;
  }

  get state(): WsConnectionState {
    return this._state;
  }

  connect(): void {
    if (this._closed) return;
    this._setState("connecting");
    try {
      const url = getBackendWebSocketUrl(this.opts.path);
      this.ws = new WebSocket(url);
      this.ws.onopen = this._onOpen;
      this.ws.onmessage = this._onMessage;
      this.ws.onclose = this._onClose;
      this.ws.onerror = this._onError;
    } catch (err) {
      this._setState("error");
      this._scheduleReconnect();
    }
  }

  disconnect(): void {
    this._closed = true;
    this._clearTimers();
    this.ws?.close();
    this._setState("disconnected");
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  }

  private _setState(s: WsConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    this.opts.onStateChange(s);
  }

  private _onOpen = (): void => {
    this._attempts = 0;
    this._delay = this.opts.initialDelay;
    this._setState("connected");
    if (this.opts.pingInterval > 0) {
      this._pingTimer = setInterval(() => this.send({ type: "ping" }), this.opts.pingInterval);
    }
  };

  private _onMessage = (event: MessageEvent): void => {
    try {
      const data = JSON.parse(event.data as string);
      this.opts.onMessage(data);
    } catch {
      this.opts.onMessage(event.data);
    }
  };

  private _onClose = (): void => {
    this._clearPing();
    if (!this._closed) {
      this._setState("disconnected");
      this._scheduleReconnect();
    }
  };

  private _onError = (event: Event): void => {
    this.opts.onError(event);
    this._setState("error");
  };

  private _scheduleReconnect(): void {
    if (this._closed) return;
    const { maxAttempts } = this.opts;
    if (maxAttempts > 0 && this._attempts >= maxAttempts) return;
    this._attempts++;
    this._reconnectTimer = setTimeout(() => {
      this._delay = Math.min(this._delay * this.opts.backoffFactor, this.opts.maxDelay);
      this.connect();
    }, this._delay);
  }

  private _clearPing(): void {
    if (this._pingTimer !== null) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  private _clearTimers(): void {
    this._clearPing();
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}
