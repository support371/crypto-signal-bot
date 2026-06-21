/**
 * WebSocket Client for Real-time Updates
 * 
 * This module provides a WebSocket client for receiving real-time updates
 * from the backend. In paper trading mode, it connects to a mock WebSocket server.
 */

import { io, Socket } from 'socket.io-client';
import { env } from './env';
import { getRuntimeConfig } from './runtimeConfig';
import { WebSocketEvent, WebSocketEventType } from './backendTypes';

// WebSocket connection state
type WebSocketState = {
  connected: boolean;
  socket: Socket | null;
  listeners: Map<WebSocketEventType, Set<(data: any) => void>>;
};

const state: WebSocketState = {
  connected: false,
  socket: null,
  listeners: new Map(),
};

// Mock WebSocket for paper trading mode
class MockSocket {
  private handlers: Map<string, (data: any) => void> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Simulate periodic updates in mock mode
    this.interval = setInterval(() => {
      const events: WebSocketEventType[] = [
        'TICKER_UPDATE',
        'SIGNAL_UPDATE',
        'ORDER_BOOK_UPDATE',
      ];
      
      const randomEvent = events[Math.floor(Math.random() * events.length)];
      const handler = this.handlers.get(randomEvent);
      
      if (handler) {
        handler({
          type: randomEvent,
          data: this.generateMockData(randomEvent),
          timestamp: new Date().toISOString(),
        });
      }
    }, 5000);
  }

  private generateMockData(eventType: WebSocketEventType): any {
    switch (eventType) {
      case 'TICKER_UPDATE':
        return {
          symbol: 'BTC/USDT',
          price: 50000 + Math.random() * 1000,
          change: (Math.random() - 0.5) * 500,
          changePercent: (Math.random() - 0.5) * 2,
          volume: Math.random() * 1000000,
          isMock: true,
        };
      case 'SIGNAL_UPDATE':
        return {
          id: `mock-signal-${Date.now()}`,
          symbol: 'BTC/USDT',
          signal: ['BUY', 'SELL'][Math.floor(Math.random() * 2)],
          strength: ['STRONG', 'MEDIUM', 'WEAK'][Math.floor(Math.random() * 3)],
          confidence: 0.5 + Math.random() * 0.5,
          entryPrice: 50000 + Math.random() * 1000,
          isMock: true,
        };
      case 'ORDER_BOOK_UPDATE':
        return {
          symbol: 'BTC/USDT',
          bids: Array.from({ length: 5 }, () => [
            50000 + Math.random() * 1000,
            Math.random() * 100,
          ]),
          asks: Array.from({ length: 5 }, () => [
            50000 + Math.random() * 1000,
            Math.random() * 100,
          ]),
          isMock: true,
        };
      default:
        return {};
    }
  }

  on(event: string, handler: (data: any) => void): void {
    this.handlers.set(event, handler);
  }

  off(event: string, handler: (data: any) => void): void {
    this.handlers.delete(event);
  }

  connect(): void {
    // Mock connect
  }

  disconnect(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  close(): void {
    this.disconnect();
  }
}

/**
 * Connect to WebSocket server
 */
export function connectWebSocket(): void {
  if (state.connected) {
    console.log('[WebSocket] Already connected');
    return;
  }

  const runtimeConfig = getRuntimeConfig();

  try {
    if (runtimeConfig.paperTradingMode) {
      console.log('[WebSocket] Using mock connection for paper trading mode');
      state.socket = new MockSocket() as unknown as Socket;
      state.connected = true;
      
      // Emit connected event
      emit('CONNECTED', { message: 'Mock WebSocket connected' });
      return;
    }

    console.log('[WebSocket] Connecting to:', env.wsBaseUrl);
    
    state.socket = io(env.wsBaseUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    state.socket.on('connect', () => {
      state.connected = true;
      console.log('[WebSocket] Connected');
      emit('CONNECTED', { message: 'WebSocket connected' });
    });

    state.socket.on('disconnect', () => {
      state.connected = false;
      console.log('[WebSocket] Disconnected');
      emit('DISCONNECTED', { message: 'WebSocket disconnected' });
    });

    state.socket.on('error', (error: any) => {
      console.error('[WebSocket] Error:', error);
      emit('ERROR', { error: error.message || String(error) });
    });

    // Listen for all event types
    ['TICKER_UPDATE', 'ORDER_BOOK_UPDATE', 'SIGNAL_UPDATE', 'TRADE_EXECUTED', 
     'ORDER_UPDATE', 'BALANCE_UPDATE', 'ALERT_TRIGGERED'].forEach(event => {
      state.socket?.on(event, (data: any) => {
        emit(event as WebSocketEventType, data);
      });
    });

  } catch (error) {
    console.error('[WebSocket] Connection error:', error);
    emit('ERROR', { error: 'Failed to connect to WebSocket' });
  }
}

/**
 * Disconnect from WebSocket server
 */
export function disconnectWebSocket(): void {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
    state.connected = false;
    console.log('[WebSocket] Disconnected');
  }
}

/**
 * Check if WebSocket is connected
 */
export function isWebSocketConnected(): boolean {
  return state.connected;
}

/**
 * Subscribe to WebSocket events
 */
export function onWebSocketEvent(
  event: WebSocketEventType,
  handler: (data: any) => void
): () => void {
  if (!state.listeners.has(event)) {
    state.listeners.set(event, new Set());
  }
  state.listeners.get(event)?.add(handler);

  // Return unsubscribe function
  return () => {
    state.listeners.get(event)?.delete(handler);
  };
}

/**
 * Emit WebSocket event to subscribers
 */
function emit(event: WebSocketEventType, data: any): void {
  const handlers = state.listeners.get(event);
  if (handlers) {
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[WebSocket] Error in ${event} handler:`, error);
      }
    });
  }
}

/**
 * Send a message through WebSocket
 */
export function sendWebSocketMessage(event: string, data: any): void {
  if (state.socket && state.connected) {
    state.socket.emit(event, data);
  } else {
    console.warn('[WebSocket] Not connected. Message not sent:', event, data);
  }
}

/**
 * Get WebSocket connection state
 */
export function getWebSocketState() {
  return {
    connected: state.connected,
    socket: state.socket,
  };
}