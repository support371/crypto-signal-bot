import type { Signal } from '../types/crypto';

export interface WorkerSignalResponse {
  symbol?: string;
  direction?: string;
  side?: string;
  confidence: number;
  regime?: string;
  horizon?: number;
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

  let direction: Signal['direction'];
  const rawDirection = String(data.direction ?? '').toUpperCase();
  if (rawDirection === 'UP' || rawDirection === 'DOWN' || rawDirection === 'NEUTRAL') {
    direction = rawDirection;
  } else {
    const side = String(data.side ?? '').toUpperCase();
    direction = side === 'BUY' ? 'UP' : side === 'SELL' ? 'DOWN' : 'NEUTRAL';
  }

  const rawConfidence = Number(data.confidence);
  const confidencePct = Number.isFinite(rawConfidence)
    ? Math.round(Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)))
    : 0;

  type Regime = Signal['regime'];
  const VALID_REGIMES: Regime[] = ['TREND', 'RANGE', 'CHAOS'];
  const rawRegime = String(data.regime ?? '').toUpperCase() as Regime;
  const regime: Regime = VALID_REGIMES.includes(rawRegime)
    ? rawRegime
    : (confidencePct >= 65 ? 'TREND' : 'RANGE');
  const horizon = typeof data.horizon === 'number' && data.horizon > 0
    ? data.horizon
    : 60;

  return {
    direction,
    confidence: confidencePct,
    regime,
    horizon,
  };
}
