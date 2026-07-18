import type { Signal } from '../types/crypto';

export interface WorkerSignalResponse {
  symbol?: string;
  side: string;
  confidence: number;
  strategy?: string | null;
  available?: boolean;
}

export function normalizeWorkerSignal(
  data: WorkerSignalResponse,
  expectedBackendSymbol: string,
): Signal | null {
  if (data.available === false) return null;

  const responseSymbol = String(data.symbol ?? '').toUpperCase().replace(/(USDT|USD)$/i, '');
  if (responseSymbol && responseSymbol !== expectedBackendSymbol) return null;

  const side = String(data.side ?? '').toUpperCase();
  const direction: Signal['direction'] = side === 'BUY'
    ? 'UP'
    : side === 'SELL'
      ? 'DOWN'
      : 'NEUTRAL';
  const rawConfidence = Number(data.confidence);
  const confidencePct = Number.isFinite(rawConfidence)
    ? Math.round(Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)))
    : 0;
  const strong = confidencePct >= 65;

  return {
    direction,
    confidence: confidencePct,
    regime: strong ? 'TREND' : 'RANGE',
    horizon: 60,
  };
}
