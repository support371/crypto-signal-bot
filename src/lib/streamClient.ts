/**
 * streamClient.ts
 *
 * Canonical WebSocket client for the /stream endpoint.
 * Singleton — shared across all useStream() hook instances.
 * Reconnects with exponential backoff: 1s → 2s → 5s → 10s → 20s → 30s max + jitter.
 */

import { getBackendWebSocketUrl } from '@/lib/backend';

export type StreamStatus =
  | 'connecting'
  | 'connected'
  | 'waking'
  | 'reconnecting'
  | 'degraded'
  | 'offline';

export interface StreamEvent {
  type: string;
  event_id?: string;
  trace_id?: string;
  timestamp?: string | number;
  payload?: unknown;
  [key: string]: unknown;
}

export interface StreamState {
  status: StreamStatus;
  connected: boolean;
  reconnectAttempt: number;
  nextRetryMs: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastMessageAt: number | null;
}

type StreamListener = (event: StreamEvent) => void;
type StateListener = (state: StreamState) => void;

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 20000, 30000];
const MAX_JITTER_MS = 500;

function getStreamWsUrl(): string {
  const base = getBackendWebSocketUrl();
  return base.replace(/\/ws(\/updates)?$/, '/stream');
}

function jitter(): number {
  return Math.floor(Math.random() * MAX_JITTER_MS);
}

function getBackoffMs(attempt: number): number {
  const step = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];
  return step + jitter();
}

class StreamClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private mounted = false;
  private attempt = 0;
  private lastPingAt = 0;
  private refCount = 0;

  private state: StreamState = {
    status: 'offline',
    connected: false,
    reconnectAttempt: 0,
    nextRetryMs: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastMessageAt: null,
  };

  private eventListeners = new Set<StreamListener>();
  private stateListeners = new Set<StateListener>();

  onEvent(listener: StreamListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  getState(): StreamState {
    return { ...this.state };
  }

  private setState(patch: Partial<StreamState>) {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((l) => l(this.getState()));
  }

  private dispatch(event: StreamEvent) {
    this.setState({ lastMessageAt: Date.now() });
    this.eventListeners.forEach((l) => l(event));
  }

  acquire() {
    this.refCount += 1;
    if (!this.mounted) {
      this.mounted = true;
      this.attempt = 0;
      this.connect();
    }
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.mounted = false;
      this.clearTimer();
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.setState({ status: 'offline', connected: false });
    }
  }

  private clearTimer() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.mounted) return;
    this.clearTimer();
    const delay = getBackoffMs(this.attempt);
    this.attempt += 1;
    const status: StreamStatus =
      this.attempt <= 2 ? 'waking' : this.attempt <= 4 ? 'reconnecting' : 'degraded';
    this.setState({ status, reconnectAttempt: this.attempt, nextRetryMs: delay });
    this.reconnectTimer = setTimeout(() => {
      if (this.mounted) this.connect();
    }, delay);
  }

  private connect() {
    if (!this.mounted) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
    ) return;

    this.setState({ status: 'connecting' });

    let ws: WebSocket;
    try {
      ws = new WebSocket(getStreamWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (!this.mounted || this.ws !== ws) return;
      this.attempt = 0;
      this.lastPingAt = Date.now();
      this.setState({
        status: 'connected',
        connected: true,
        reconnectAttempt: 0,
        nextRetryMs: 0,
        lastConnectedAt: Date.now(),
      });
    };

    ws.onmessage = (event) => {
      if (!this.mounted || this.ws !== ws) return;
      this.lastPingAt = Date.now();
      let msg: StreamEvent;
      try {
        msg = JSON.parse(event.data) as StreamEvent;
      } catch {
        return;
      }
      if (msg.type === 'heartbeat' || msg.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) ws.send('pong');
        return;
      }
      this.dispatch(msg);
    };

    ws.onclose = () => {
      if (!this.mounted || this.ws !== ws) return;
      this.ws = null;
      this.setState({ connected: false, lastDisconnectedAt: Date.now() });
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  handleVisibilityChange() {
    if (document.visibilityState !== 'visible' || !this.mounted) return;
    const stale = Date.now() - this.lastPingAt > 30000;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || stale) {
      if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
      this.ws = null;
      this.attempt = 0;
      this.clearTimer();
      this.connect();
    }
  }
}

export const streamClient = new StreamClient();
