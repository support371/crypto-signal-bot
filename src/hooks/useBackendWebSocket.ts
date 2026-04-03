import { useCallback, useEffect, useRef, useState } from 'react';
import { getBackendBaseUrl } from '@/lib/backend';

export interface WsHealthMessage {
  type: 'health';
  kill_switch_active: boolean;
  mode: string;
  api_error_count: number;
  guardian_triggered: boolean;
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

export type WsMessage =
  | WsHealthMessage
  | WsOrderUpdateMessage
  | WsGuardianAlertMessage
  | WsKillSwitchMessage;

interface UseBackendWebSocketOptions {
  onHealthUpdate?: (msg: WsHealthMessage) => void;
  onOrderUpdate?: (msg: WsOrderUpdateMessage) => void;
  onGuardianAlert?: (msg: WsGuardianAlertMessage) => void;
  onKillSwitchChange?: (msg: WsKillSwitchMessage) => void;
  reconnectDelayMs?: number;
}

interface WebSocketState {
  connected: boolean;
  lastMessage: WsMessage | null;
  lastGuardianAlert: WsGuardianAlertMessage | null;
}

function getWsUrl(): string {
  const base = getBackendBaseUrl();
  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws/updates`;
}

export function useBackendWebSocket(options: UseBackendWebSocketOptions = {}): WebSocketState {
  const {
    onHealthUpdate,
    onOrderUpdate,
    onGuardianAlert,
    onKillSwitchChange,
    reconnectDelayMs = 5000,
  } = options;

  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [lastGuardianAlert, setLastGuardianAlert] = useState<WsGuardianAlertMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data) as WsMessage;
      } catch {
        return;
      }

      setLastMessage(msg);

      switch (msg.type) {
        case 'health':
          onHealthUpdate?.(msg);
          break;
        case 'order_update':
          onOrderUpdate?.(msg);
          break;
        case 'guardian_alert':
          setLastGuardianAlert(msg);
          onGuardianAlert?.(msg);
          break;
        case 'kill_switch':
          onKillSwitchChange?.(msg);
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      // Schedule reconnect
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, reconnectDelayMs);
    };

    ws.onerror = () => {
      // onclose fires after onerror, which handles reconnect
      ws.close();
    };
  }, [onHealthUpdate, onOrderUpdate, onGuardianAlert, onKillSwitchChange, reconnectDelayMs]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearReconnectTimer]);

  return { connected, lastMessage, lastGuardianAlert };
}
