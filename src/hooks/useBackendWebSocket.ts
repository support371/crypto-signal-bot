import { useCallback, useEffect, useRef, useState } from 'react';
import { getBackendWebSocketUrl } from '@/lib/backend';

export interface WsHealthMessage {
  type: 'health';
  kill_switch_active: boolean;
  mode: string;
  api_error_count: number | null;
  guardian_triggered: boolean;
  market_data_mode: string;
  market_data_connected: boolean;
}

export interface WsTickerMessage {
  type: 'ticker';
  symbol: string;
  price: number;
  change: number;
  timestamp: number;
}

export interface WsStatusMessage {
  type: 'status';
  ws: string;
  backend: string;
}

export interface WsOrderUpdateMessage {
  type: 'order_update';
  intent_id: string;
  status: string;
  symbol: string;
  side: string;
  fill_price: number | null;
}

export interface WsGuardianAlertMessage {
  type: 'guardian_alert';
  reason: string;
  kill_switch_active: boolean;
  timestamp: number;
}

export interface WsKillSwitchMessage {
  type: 'kill_switch';
  active: boolean;
  reason: string | null;
}

export interface WsMarketUpdateMessage {
  type: 'market_update';
  symbol: string;
  price: number;
  change24h: number;
  signal: {
    direction: string;
    confidence: number;
    regime: string;
    horizon: number;
  };
  risk: {
    score: number;
    decision: string;
    approved: boolean;
    positionSize: number;
    reasoning: string;
  };
  timestamp: number;
  source: string;
}

export interface WsExchangeStatusMessage {
  type: 'exchange_status';
  exchange: string | null;
  market_data_mode: string;
  connected: boolean;
  connection_state: string;
  fallback_active: boolean;
  last_update_ts: number | null;
  last_error: string | null;
  stale: boolean;
  symbols: string[];
  source: string;
}

export interface WsOrderStateMessage {
  type: 'order_state'; sequence_id: number; event_id: string; order_id: string;
  account_id: string; previous_state: string | null; state: string;
  source: string; occurred_at: string; evidence_hash: string; audit_hash: string;
}
export interface WsOrderStreamStatusMessage {
  type: 'order_stream_status'; authenticated: boolean; cursor?: number; code?: string;
}

export interface WsPingMessage {
  type: 'ping';
}

export type WsMessage =
  | WsHealthMessage
  | WsTickerMessage
  | WsStatusMessage
  | WsOrderUpdateMessage
  | WsGuardianAlertMessage
  | WsKillSwitchMessage
  | WsMarketUpdateMessage
  | WsExchangeStatusMessage
  | WsPingMessage
  | WsOrderStateMessage
  | WsOrderStreamStatusMessage;

interface UseBackendWebSocketOptions {
  accessToken?: string;
  actorId?: string;
  onHealthUpdate?: (msg: WsHealthMessage) => void;
  onTickerUpdate?: (msg: WsTickerMessage) => void;
  onOrderUpdate?: (msg: WsOrderUpdateMessage) => void;
  onGuardianAlert?: (msg: WsGuardianAlertMessage) => void;
  onKillSwitchChange?: (msg: WsKillSwitchMessage) => void;
  onMarketUpdate?: (msg: WsMarketUpdateMessage) => void;
  onExchangeStatus?: (msg: WsExchangeStatusMessage) => void;
}

interface WebSocketState {
  connected: boolean;
  lastMessage: WsMessage | null;
  lastGuardianAlert: WsGuardianAlertMessage | null;
  orderEvents: WsOrderStateMessage[];
  orderStreamAuthenticated: boolean;
}

// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

function getWsUrl(): string {
  return getBackendWebSocketUrl();
}

export function useBackendWebSocket(options: UseBackendWebSocketOptions = {}): WebSocketState {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [lastGuardianAlert, setLastGuardianAlert] = useState<WsGuardianAlertMessage | null>(null);

  const [orderEvents, setOrderEvents] = useState<WsOrderStateMessage[]>([]);
  const [orderStreamAuthenticated, setOrderStreamAuthenticated] = useState(false);
  const eventCursorRef = useRef(0);
  const identityRef = useRef(options.actorId);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);
  const lastPingRef = useRef<number>(0);

  // Store callbacks in refs so connect() doesn't need them as deps
  const cbRef = useRef(options);
  cbRef.current = options;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    clearReconnectTimer();
    const delay = Math.min(MIN_RECONNECT_MS * Math.pow(2, attemptRef.current), MAX_RECONNECT_MS);
    attemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current) connectRef.current();
    }, delay);
  }, [clearReconnectTimer]);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;
    // Prevent duplicate sockets
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    const url = getWsUrl();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      attemptRef.current = 0; // Reset backoff on successful connect
      setConnected(true);
      lastPingRef.current = Date.now();
      if (cbRef.current.accessToken) ws.send(JSON.stringify({ type: 'authenticate_orders',
        access_token: cbRef.current.accessToken, after_sequence: eventCursorRef.current }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      // Ignore messages from a superseded socket
      if (wsRef.current !== ws) return;
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }

      // Track heartbeat
      if (msg.type === 'ping' || msg.type === 'status') {
        lastPingRef.current = Date.now();
        // Respond to ping with pong
        if (msg.type === 'ping' && ws.readyState === WebSocket.OPEN) {
          ws.send('pong');
        }
        // Heartbeat/status messages don't need to propagate to UI state
        return;
      }

      if (msg.type === 'order_state') {
        if (!Number.isSafeInteger(msg.sequence_id) || msg.sequence_id <= eventCursorRef.current) return;
        eventCursorRef.current = msg.sequence_id;
        setOrderEvents((events) => [...events, msg].slice(-100));
        return;
      }
      if (msg.type === 'order_stream_status') {
        setOrderStreamAuthenticated(msg.authenticated === true);
        return;
      }
      setLastMessage(msg);

      const cbs = cbRef.current;
      switch (msg.type) {
        case 'health':
          cbs.onHealthUpdate?.(msg);
          break;
        case 'ticker':
          cbs.onTickerUpdate?.(msg);
          break;
        case 'order_update':
          cbs.onOrderUpdate?.(msg);
          break;
        case 'guardian_alert':
          setLastGuardianAlert(msg);
          cbs.onGuardianAlert?.(msg);
          break;
        case 'kill_switch':
          cbs.onKillSwitchChange?.(msg);
          break;
        case 'market_update':
          cbs.onMarketUpdate?.(msg);
          break;
        case 'exchange_status':
          cbs.onExchangeStatus?.(msg);
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      // Guard: if another socket already took over (e.g. visibility change
      // reconnect), don't clobber the new connection.
      if (wsRef.current !== ws) return;
      setConnected(false);
      setOrderStreamAuthenticated(false);
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
      ws.close();
    };
  }, [scheduleReconnect]);

  // Keep connectRef in sync so scheduleReconnect can call the latest connectWs
  connectRef.current = connectWs;

  // Main effect: connect + visibility/focus reconnect
  useEffect(() => {
    mountedRef.current = true;
    connectWs();

    // Reconnect on tab resume (mobile wake, tab switch)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        // If socket is dead or stale (no ping in 30s), reconnect
        const ws = wsRef.current;
        const stale = Date.now() - lastPingRef.current > 30000;
        if (!ws || ws.readyState !== WebSocket.OPEN || stale) {
          if (ws) {
            try { ws.close(); } catch { /* ignore */ }
          }
          wsRef.current = null;
          attemptRef.current = 0;
          clearReconnectTimer();
          connectWs();
        }
      }
    };

    const handleFocus = () => {
      if (mountedRef.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          attemptRef.current = 0;
          clearReconnectTimer();
          connectWs();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs, clearReconnectTimer, options.accessToken, options.actorId]);

  useEffect(() => {
    if (identityRef.current !== options.actorId) {
      identityRef.current = options.actorId;
      eventCursorRef.current = 0;
      setOrderEvents([]);
    }
    setOrderStreamAuthenticated(false);
  }, [options.actorId, options.accessToken]);

  return { connected, lastMessage, lastGuardianAlert,
    orderEvents: identityRef.current === options.actorId ? orderEvents : [],
    orderStreamAuthenticated: identityRef.current === options.actorId && orderStreamAuthenticated };
}
