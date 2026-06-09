/**
 * src/hooks/useStream.ts
 *
 * React hook wrapping StreamClient.
 * Provides typed message callbacks and connection-state tracking.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { StreamClient, WsConnectionState } from "@/lib/streamClient";

export interface UseStreamOptions<T = unknown> {
  path?: string;
  enabled?: boolean;
  onMessage?: (msg: T) => void;
  onStateChange?: (state: WsConnectionState) => void;
}

export function useStream<T = unknown>({
  path = "/ws",
  enabled = true,
  onMessage,
  onStateChange,
}: UseStreamOptions<T> = {}) {
  const [state, setState] = useState<WsConnectionState>("idle");
  const clientRef = useRef<StreamClient | null>(null);
  const onMessageRef = useRef(onMessage);
  const onStateRef = useRef(onStateChange);
  onMessageRef.current = onMessage;
  onStateRef.current = onStateChange;

  useEffect(() => {
    if (!enabled) return;

    const client = new StreamClient({
      path,
      onMessage: (data) => onMessageRef.current?.(data as T),
      onStateChange: (s) => {
        setState(s);
        onStateRef.current?.(s);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => client.disconnect();
  }, [path, enabled]);

  const send = useCallback((data: unknown) => clientRef.current?.send(data), []);

  return { state, send };
}
