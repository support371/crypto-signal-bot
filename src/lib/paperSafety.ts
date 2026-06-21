/**
 * Paper Trading Safety Module
 * 
 * This module ensures that all trading operations use mock data
 * and prevents any real trading from occurring.
 * 
 * SECURITY: This is the primary safety layer for paper trading mode.
 * All exchange interactions must go through this module.
 */

import { enforceOperatorBoundary } from './operatorBoundary';
import { MockExchangeData, MockOrder, MockSignal, MockTrade, MockBalance } from './backendTypes';

// Mock data generators for paper trading
const MOCK_EXCHANGES = ['binance', 'coinbase', 'kraken', 'okx'];
const MOCK_SYMBOLS = [
  'BTC/USDT',
  'ETH/USDT',
  'SOL/USDT',
  'ADA/USDT',
  'XRP/USDT',
  'DOT/USDT',
  'DOGE/USDT',
  'AVAX/USDT',
  'MATIC/USDT',
  'LINK/USDT',
];

const MOCK_SIGNAL_TYPES = ['BUY', 'SELL', 'HOLD'];
const MOCK_SIGNAL_STRENGTHS = ['STRONG', 'MEDIUM', 'WEAK'];

/**
 * Generate mock exchange data
 */
export function generateMockExchangeData(): MockExchangeData {
  enforceOperatorBoundary('generate_mock_data', { isPaper: true });
  
  return {
    id: `mock-${Date.now()}`,
    name: MOCK_EXCHANGES[Math.floor(Math.random() * MOCK_EXCHANGES.length)],
    connected: true,
    lastUpdate: new Date().toISOString(),
    latency: Math.random() * 100,
    isMock: true,
  };
}

/**
 * Generate mock market data for a symbol
 */
export function generateMockMarketData(symbol: string = MOCK_SYMBOLS[0]): any {
  enforceOperatorBoundary('generate_mock_market_data', { isPaper: true });
  
  const basePrice = 100 + Math.random() * 90000;
  const changePercent = (Math.random() - 0.5) * 10;
  const change = basePrice * (changePercent / 100);
  const currentPrice = basePrice + change;
  
  return {
    symbol,
    price: currentPrice,
    change: change,
    changePercent: changePercent,
    volume: Math.random() * 1000000,
    high: currentPrice * (1 + Math.random() * 0.05),
    low: currentPrice * (1 - Math.random() * 0.05),
    open: basePrice,
    close: currentPrice,
    timestamp: new Date().toISOString(),
    isMock: true,
  };
}

/**
 * Generate mock balance
 */
export function generateMockBalance(): MockBalance {
  enforceOperatorBoundary('generate_mock_balance', { isPaper: true });
  
  return {
    total: 100000 + Math.random() * 900000,
    available: 50000 + Math.random() * 400000,
    inUse: 10000 + Math.random() * 50000,
    currency: 'USDT',
    assets: MOCK_SYMBOLS.map(symbol => ({
      symbol: symbol.split('/')[0],
      amount: Math.random() * 100,
      value: Math.random() * 10000,
    })),
    isMock: true,
  };
}

/**
 * Generate mock order
 */
export function generateMockOrder(overrides: Partial<MockOrder> = {}): MockOrder {
  enforceOperatorBoundary('generate_mock_order', { isPaper: true });
  
  const symbol = MOCK_SYMBOLS[Math.floor(Math.random() * MOCK_SYMBOLS.length)];
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  
  return {
    id: `mock-order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    symbol,
    side,
    type: 'LIMIT',
    price: 100 + Math.random() * 90000,
    amount: 0.001 + Math.random() * 10,
    filled: Math.random(),
    status: ['PENDING', 'FILLED', 'CANCELLED'][Math.floor(Math.random() * 3)],
    createdAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
    isMock: true,
    ...overrides,
  };
}

/**
 * Generate mock trade
 */
export function generateMockTrade(): MockTrade {
  enforceOperatorBoundary('generate_mock_trade', { isPaper: true });
  
  const symbol = MOCK_SYMBOLS[Math.floor(Math.random() * MOCK_SYMBOLS.length)];
  
  return {
    id: `mock-trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    symbol,
    side: Math.random() > 0.5 ? 'BUY' : 'SELL',
    price: 100 + Math.random() * 90000,
    amount: 0.001 + Math.random() * 10,
    fee: 0.001,
    profit: (Math.random() - 0.5) * 1000,
    profitPercent: (Math.random() - 0.5) * 10,
    createdAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    isMock: true,
  };
}

/**
 * Generate mock signal
 */
export function generateMockSignal(): MockSignal {
  enforceOperatorBoundary('generate_mock_signal', { isPaper: true });
  
  const symbol = MOCK_SYMBOLS[Math.floor(Math.random() * MOCK_SYMBOLS.length)];
  const signalType = MOCK_SIGNAL_TYPES[Math.floor(Math.random() * MOCK_SIGNAL_TYPES.length)];
  const strength = MOCK_SIGNAL_STRENGTHS[Math.floor(Math.random() * MOCK_SIGNAL_STRENGTHS.length)];
  
  return {
    id: `mock-signal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    symbol,
    signal: signalType,
    strength,
    confidence: 0.5 + Math.random() * 0.5,
    entryPrice: 100 + Math.random() * 90000,
    targetPrice: 100 + Math.random() * 90000,
    stopLoss: 100 + Math.random() * 90000,
    riskReward: 1 + Math.random() * 5,
    indicators: {
      rsi: Math.random() * 100,
      macd: (Math.random() - 0.5) * 10,
      bollinger: Math.random() * 2 - 1,
      volume: Math.random() * 100,
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    isMock: true,
  };
}

/**
 * Generate multiple mock signals
 */
export function generateMockSignals(count: number = 10): MockSignal[] {
  enforceOperatorBoundary('generate_mock_signals', { isPaper: true });
  
  return Array.from({ length: count }, () => generateMockSignal());
}

/**
 * Generate multiple mock orders
 */
export function generateMockOrders(count: number = 5): MockOrder[] {
  enforceOperatorBoundary('generate_mock_orders', { isPaper: true });
  
  return Array.from({ length: count }, () => generateMockOrder());
}

/**
 * Generate multiple mock trades
 */
export function generateMockTrades(count: number = 10): MockTrade[] {
  enforceOperatorBoundary('generate_mock_trades', { isPaper: true });
  
  return Array.from({ length: count }, () => generateMockTrade());
}

/**
 * Verify that data is mock data
 */
export function verifyMockData(data: any): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data === 'object') {
    if (data.isMock === true) return true;
    return Object.values(data).some(verifyMockData);
  }
  if (Array.isArray(data)) {
    return data.some(verifyMockData);
  }
  return false;
}

/**
 * Ensure all outgoing data is marked as mock
 */
export function markAsMock<T extends object>(data: T): T & { isMock: boolean } {
  return { ...data, isMock: true };
}