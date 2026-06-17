import { useEffect, useRef, useState } from 'react';
import { streamClient, StreamEvent, StreamState } from '@/lib/streamClient';

/** Returns live connection state for the /stream WebSocket. */
export function useStream(): StreamState {
  const [state, setState] = useState<StreamState>(streamClient.getState());

  useEffect(() => {
    streamClient.acquire();
    const unsub = streamClient.onStateChange(setState);
    const handleVisibility = () => streamClient.handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', handleVisibility);
      streamClient.release();
    };
  }, []);

  return state;
}

/** Subscribe to typed stream events without freezing the latest handler closure. */
export function useStreamEvents(handler: (event: StreamEvent) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    streamClient.acquire();
    const unsub = streamClient.onEvent((event) => handlerRef.current(event));
    return () => {
      unsub();
      streamClient.release();
    };
  }, []);
}
