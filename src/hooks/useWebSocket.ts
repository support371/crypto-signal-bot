/**
 * useWebSocket Hook
 * 
 * Custom hook for accessing WebSocket state and methods.
 */

import { useWebSocket as useWebSocketProvider } from '../providers/WebSocketProvider';

export function useWebSocket() {
  return useWebSocketProvider();
}

export default useWebSocket;