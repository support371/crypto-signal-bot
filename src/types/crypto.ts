export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  lastUpdated: string;
}

export interface Signal {
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  regime: 'TREND' | 'RANGE' | 'CHAOS';
  horizon: number;
}

export interface RiskAssessment {
  score: number;
  decision: 'ENTER_LONG' | 'ENTER_SHORT' | 'HOLD' | 'EXIT';
  approved: boolean;
  positionSize: number;
  reasoning: string;
}

export interface MicrostructureFeatures {
  spreadPercentage: number;
  orderBookImbalance: number;
  midPriceVelocity: number;
  volatilitySpike: boolean;
  depthDecay: number;
}

export interface Trade {
  id: string;
  portfolioId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  status: 'OPEN' | 'CLOSED';
  signalConfidence?: number;
  riskScore?: number;
  createdAt: string;
  closedAt?: string;
}

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  startingBalance: number;
  currentBalance: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  id: string;
  userId: string;
  riskTolerance: number;
  spreadStressThreshold: number;
  volatilitySensitivity: number;
  positionSizeFraction: number;
  autoTradeEnabled: boolean;
  soundAlertsEnabled: boolean;
}
