import { useCallback, useEffect, useState } from 'react';
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

/** Subscribe to typed stream events. Handler must be stable (useCallback). */
export function useStreamEvents(handler: (event: StreamEvent) => void): void {
  const stableHandler = useCallback(handler, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    streamClient.acquire();
    const unsub = streamClient.onEvent(stableHandler);
    return () => {
      unsub();
      streamClient.release();
    };
  }, [stableHandler]);
}
