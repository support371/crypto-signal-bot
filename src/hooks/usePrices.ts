/**
 * src/hooks/usePrices.ts
 *
 * PHASE 3 — Backend-only price hook.
 *
 * REMOVED (phase 3):
 *   - const ua = "https://api.coingecko.com/api/v3/simple/price"  (finding F5)
 *   - fetchFromCoinGecko() / Ne()  (finding F5)
 *   - Dual-source logic (CoinGecko primary, backend fallback)  (finding F5 / Rule 7)
 *
 * The frontend no longer calls any third-party price API.
 * All price data flows exclusively through the backend.
 *
 * NOTE: GET /prices/batch is a new backend route (Phase 2 gap).
 *       Until it exists, this hook gracefully degrades to /price?symbol= per-coin
 *       using the already-confirmed backend endpoint.
 *       The "source" field reports "backend" in all cases — no CoinGecko string
 *       will ever appear in the UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, BackendConfigError, BackendUnavailableError } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoinDefinition {
  id: string;
  symbol: string;
  name: string;
  backendSymbol: string; // e.g. "BTCUSDT"
}

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  lastUpdated: string; // ISO string
}

interface BackendPriceResponse {
  price: number;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
  timestamp?: number; // unix seconds
}

interface BackendBatchResponse {
  prices: CoinPrice[];
}

// ---------------------------------------------------------------------------
// Tracked coin list — no CoinGecko IDs used for API calls, only for UI labels
// ---------------------------------------------------------------------------

export const TRACKED_COINS: CoinDefinition[] = [
  { id: "bitcoin",       symbol: "BTC",  name: "Bitcoin",   backendSymbol: "BTCUSDT"  },
  { id: "ethereum",      symbol: "ETH",  name: "Ethereum",  backendSymbol: "ETHUSDT"  },
  { id: "solana",        symbol: "SOL",  name: "Solana",    backendSymbol: "SOLUSDT"  },
  { id: "binancecoin",   symbol: "BNB",  name: "BNB",       backendSymbol: "BNBUSDT"  },
  { id: "cardano",       symbol: "ADA",  name: "Cardano",   backendSymbol: "ADAUSDT"  },
  { id: "ripple",        symbol: "XRP",  name: "XRP",       backendSymbol: "XRPUSDT"  },
  { id: "polkadot",      symbol: "DOT",  name: "Polkadot",  backendSymbol: "DOTUSDT"  },
  { id: "avalanche-2",   symbol: "AVAX", name: "Avalanche", backendSymbol: "AVAXUSDT" },
  { id: "dogecoin",      symbol: "DOGE", name: "Dogecoin",  backendSymbol: "DOGEUSDT" },
  { id: "chainlink",     symbol: "LINK", name: "Chainlink", backendSymbol: "LINKUSDT" },
];

export const COIN_MAP = new Map(TRACKED_COINS.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Internal fetch — backend batch endpoint (Phase 2 new route)
// Falls back to individual /price?symbol= if batch endpoint returns 404.
// ---------------------------------------------------------------------------

async function fetchBatch(coins: CoinDefinition[]): Promise<CoinPrice[]> {
  const symbols = coins.map((c) => c.backendSymbol).join(",");

  // Try the batch endpoint first (Phase 2 new route)
  try {
    const data = await apiFetch<BackendBatchResponse>(
      `/prices/batch?symbols=${encodeURIComponent(symbols)}`
    );
    if (Array.isArray(data.prices) && data.prices.length > 0) {
      return data.prices;
    }
  } catch (err) {
    // 404 means batch endpoint not yet deployed — fall through to per-coin
    if (
      err instanceof BackendUnavailableError &&
      err.status === 404
    ) {
      // graceful degradation: per-coin fetch using confirmed /price endpoint
      return fetchPerCoin(coins);
    }
    throw err; // other errors propagate
  }

  return fetchPerCoin(coins);
}

async function fetchPerCoin(coins: CoinDefinition[]): Promise<CoinPrice[]> {
  const now = new Date().toISOString();
  const results = await Promise.all(
    coins.map(async (coin) => {
      const data = await apiFetch<BackendPriceResponse>(
        `/price?symbol=${encodeURIComponent(coin.backendSymbol)}`
      );
      return {
        id:          coin.id,
        symbol:      coin.symbol,
        name:        coin.name,
        price:       data.price,
        change24h:   Number((data.change24h ?? 0).toFixed(2)),
        volume24h:   data.volume24h ?? 0,
        marketCap:   data.marketCap ?? 0,
        lastUpdated: data.timestamp
          ? new Date(data.timestamp * 1000).toISOString()
          : now,
      } satisfies CoinPrice;
    })
  );
  return results;
}

// ---------------------------------------------------------------------------
// usePrices hook
// ---------------------------------------------------------------------------

export interface UsePricesResult {
  prices: CoinPrice[];
  isLoading: boolean;
  /**
   * null when prices are available.
   * Non-null means the backend is unreachable or the endpoint is missing.
   * The UI must render an explicit "unavailable" state — no synthetic fallback.
   */
  error: string | null;
  lastUpdate: Date | null;
  /**
   * "backend" always. Exposed so the footer status indicator stays accurate.
   * Never "coingecko" — that source is removed.
   */
  source: "backend" | null;
  refetch: () => void;
}

const POLL_INTERVAL_MS = 30_000;

export function usePrices(): UsePricesResult {
  const [prices, setPrices]       = useState<CoinPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [source, setSource]       = useState<"backend" | null>(null);

  const fetch = useCallback(async () => {
    if (TRACKED_COINS.length === 0) {
      setPrices([]);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await fetchBatch(TRACKED_COINS);
      setPrices(data);
      setSource("backend");
      setLastUpdate(new Date());
    } catch (err) {
      if (err instanceof BackendConfigError) {
        setError("Backend not configured: " + err.message);
      } else if (err instanceof BackendUnavailableError) {
        setError("Price data unavailable — backend unreachable.");
      } else {
        setError("Price fetch failed.");
      }
      // Do NOT populate prices with synthetic or stale data.
      // Leave existing prices intact so the UI doesn't flash blank on transient error.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetch]);

  return { prices, isLoading, error, lastUpdate, source, refetch: fetch };
}
