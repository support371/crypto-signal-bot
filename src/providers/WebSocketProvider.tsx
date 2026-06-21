/**
 * WebSocket Provider
 * 
 * Provides WebSocket connection state and methods to the application.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { WebSocketEventType } from '../lib/backendTypes';
import { 
  connectWebSocket, 
  disconnectWebSocket, 
  isWebSocketConnected, 
  onWebSocketEvent,
  sendWebSocketMessage,
} from '../lib/websocket';

interface WebSocketContextType {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  send: (event: string, data: any) => void;
  on: (event: WebSocketEventType, handler: (data: any) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Update connection state
    const checkConnection = () => {
      setIsConnected(isWebSocketConnected());
    };

    // Check connection every second
    const interval = setInterval(checkConnection, 1000);

    // Initial check
    checkConnection();

    return () => clearInterval(interval);
  }, []);

  const connect = () => {
    connectWebSocket();
    setIsConnected(true);
  };

  const disconnect = () => {
    disconnectWebSocket();
    setIsConnected(false);
  };

  const send = (event: string, data: any) => {
    sendWebSocketMessage(event, data);
  };

  const on = (event: WebSocketEventType, handler: (data: any) => void) => {
    return onWebSocketEvent(event, handler);
  };

  const value: WebSocketContextType = {
    isConnected,
    connect,
    disconnect,
    send,
    on,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextType {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export default WebSocketProvider;