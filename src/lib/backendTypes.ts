/**
 * Backend Types for Crypto Signal Bot V2
 * 
 * This file contains all TypeScript interfaces and types used for
 * API communication and internal data structures.
 */

// ============================================================================
// Error Types
// ============================================================================

export class PaperTradingError extends Error {
  constructor(message: string = 'Paper trading mode is enforced') {
    super(message);
    this.name = 'PaperTradingError';
  }
}

export class LiveTradingBlockedError extends Error {
  constructor(message: string = 'Live trading is blocked') {
    super(message);
    this.name = 'LiveTradingBlockedError';
  }
}

export class WithdrawalBlockedError extends Error {
  constructor(message: string = 'Withdrawals are disabled') {
    super(message);
    this.name = 'WithdrawalBlockedError';
  }
}

export class PrivilegedOperationError extends Error {
  constructor(message: string = 'Privileged operation blocked') {
    super(message);
    this.name = 'PrivilegedOperationError';
  }
}

export class OperatorBoundaryError extends Error {
  constructor(message: string = 'Operator boundary violation') {
    super(message);
    this.name = 'OperatorBoundaryError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string = 'Authorization denied') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
  isMock: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  isMock: boolean;
}

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  preferences: UserPreferences;
}

export type UserRole = 'admin' | 'trader' | 'viewer' | 'guest';
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  timezone: string;
  notifications: NotificationPreferences;
  dashboard: DashboardPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  telegram: boolean;
  discord: boolean;
  signalAlerts: boolean;
  priceAlerts: boolean;
  tradeNotifications: boolean;
}

export interface DashboardPreferences {
  defaultView: 'dashboard' | 'signals' | 'portfolio' | 'trading';
  widgets: string[];
  layout: 'grid' | 'list' | 'compact';
}

// ============================================================================
// Exchange Types
// ============================================================================

export interface Exchange {
  id: string;
  name: string;
  type: ExchangeType;
  status: ExchangeStatus;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  testNet: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
}

export type ExchangeType = 'centralized' | 'decentralized' | 'mock';
export type ExchangeStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

export interface ExchangeConnection {
  id: string;
  exchangeId: string;
  userId: string;
  status: ExchangeStatus;
  lastConnectedAt?: string;
  lastError?: string;
  rateLimitRemaining: number;
  rateLimitResetAt?: string;
}

export interface MockExchangeData {
  id: string;
  name: string;
  connected: boolean;
  lastUpdate: string;
  latency: number;
  isMock: boolean;
}

// ============================================================================
// Market Data Types
// ============================================================================

export interface Ticker {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
  timestamp: string;
  exchange: string;
}

export interface Candlestick {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
  timeframe: Timeframe;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

export interface OrderBook {
  symbol: string;
  exchange: string;
  bids: [number, number][]; // [price, amount]
  asks: [number, number][]; // [price, amount]
  timestamp: string;
}

export interface MarketData {
  tickers: Ticker[];
  orderBooks: OrderBook[];
  candlesticks: Candlestick[];
  lastUpdated: string;
}

// ============================================================================
// Trading Types
// ============================================================================

export interface Balance {
  total: number;
  available: number;
  inUse: number;
  currency: string;
  assets: AssetBalance[];
}

export interface MockBalance {
  total: number;
  available: number;
  inUse: number;
  currency: string;
  assets: AssetBalance[];
  isMock: boolean;
}

export interface AssetBalance {
  symbol: string;
  amount: number;
  value: number;
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' | 'OCO';
export type OrderStatus = 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';

export interface Order {
  id: string;
  userId: string;
  exchangeId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
  filled: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  stopPrice?: number;
  stopLimitPrice?: number;
  timeInForce?: TimeInForce;
  postOnly?: boolean;
  reduceOnly?: boolean;
}

export interface MockOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
  filled: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  isMock: boolean;
}

export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'POST_ONLY';

export interface Trade {
  id: string;
  userId: string;
  orderId: string;
  exchangeId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  amount: number;
  fee: number;
  feeCurrency: string;
  profit: number;
  profitPercent: number;
  createdAt: string;
}

export interface MockTrade {
  id: string;
  symbol: string;
  side: OrderSide;
  price: number;
  amount: number;
  fee: number;
  profit: number;
  profitPercent: number;
  createdAt: string;
  isMock: boolean;
}

export interface Position {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  amount: number;
  leverage: number;
  margin: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Signal Types
// ============================================================================

export type SignalType = 'BUY' | 'SELL' | 'HOLD';
export type SignalStrength = 'STRONG' | 'MEDIUM' | 'WEAK';
export type SignalStatus = 'ACTIVE' | 'EXPIRED' | 'EXECUTED' | 'CANCELLED';

export interface Signal {
  id: string;
  userId?: string;
  symbol: string;
  signal: SignalType;
  strength: SignalStrength;
  confidence: number; // 0-1
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskReward: number;
  indicators: SignalIndicators;
  status: SignalStatus;
  createdAt: string;
  expiresAt: string;
  executedAt?: string;
  cancelledAt?: string;
  notes?: string;
}

export interface MockSignal {
  id: string;
  symbol: string;
  signal: SignalType;
  strength: SignalStrength;
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskReward: number;
  indicators: SignalIndicators;
  createdAt: string;
  expiresAt: string;
  isMock: boolean;
}

export interface SignalIndicators {
  rsi?: number;
  macd?: number;
  bollinger?: number;
  volume?: number;
  movingAverages?: {
    short: number;
    medium: number;
    long: number;
  };
  [key: string]: number | object | undefined;
}

export interface SignalHistory {
  signalId: string;
  action: 'CREATED' | 'UPDATED' | 'EXECUTED' | 'EXPIRED' | 'CANCELLED';
  timestamp: string;
  data: any;
}

// ============================================================================
// Alert Types
// ============================================================================

export type AlertType = 'PRICE' | 'SIGNAL' | 'VOLUME' | 'INDICATOR' | 'CUSTOM';
export type AlertCondition = 'ABOVE' | 'BELOW' | 'EQUALS' | 'CROSSES_ABOVE' | 'CROSSES_BELOW';

export interface Alert {
  id: string;
  userId: string;
  name: string;
  type: AlertType;
  symbol: string;
  condition: AlertCondition;
  value: number;
  isActive: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  notifyTelegram: boolean;
  notifyDiscord: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
}

export interface AlertTrigger {
  id: string;
  alertId: string;
  symbol: string;
  currentValue: number;
  triggerValue: number;
  triggeredAt: string;
  notified: boolean;
}

// ============================================================================
// Backtesting Types
// ============================================================================

export interface Backtest {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  strategy: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialBalance: number;
  status: BacktestStatus;
  results?: BacktestResults;
  createdAt: string;
  updatedAt: string;
}

export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfit: number;
  totalProfitPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  avgProfit: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  trades: BacktestTrade[];
  equityCurve: number[];
}

export interface BacktestTrade {
  entryPrice: number;
  exitPrice: number;
  profit: number;
  profitPercent: number;
  direction: OrderSide;
  entryTime: string;
  exitTime: string;
}

// ============================================================================
// Analytics Types
// ============================================================================

export interface PortfolioPerformance {
  totalValue: number;
  totalProfit: number;
  totalProfitPercent: number;
  dailyChange: number;
  dailyChangePercent: number;
  weeklyChange: number;
  weeklyChangePercent: number;
  monthlyChange: number;
  monthlyChangePercent: number;
  yearlyChange: number;
  yearlyChangePercent: number;
  bestPerformer: string;
  worstPerformer: string;
}

export interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  avgProfit: number;
  avgLoss: number;
  maxProfit: number;
  maxLoss: number;
  currentStreak: number;
  bestStreak: number;
}

export interface SignalStats {
  totalSignals: number;
  accurateSignals: number;
  accuracyRate: number;
  avgConfidence: number;
  signalsByType: Record<SignalType, number>;
  signalsByStrength: Record<SignalStrength, number>;
}

// ============================================================================
// Notification Types
// ============================================================================

export type NotificationType = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'ALERT';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  data?: any;
  createdAt: string;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export type WebSocketEventType = 
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'TICKER_UPDATE'
  | 'ORDER_BOOK_UPDATE'
  | 'SIGNAL_UPDATE'
  | 'TRADE_EXECUTED'
  | 'ORDER_UPDATE'
  | 'BALANCE_UPDATE'
  | 'ALERT_TRIGGERED';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: any;
  timestamp: string;
}

export interface WebSocketMessage {
  event: WebSocketEventType;
  payload: any;
  timestamp: string;
}

// ============================================================================
// Query Keys for TanStack Query
// ============================================================================

export const QueryKeys = {
  // User
  user: ['user'] as const,
  userPreferences: ['user', 'preferences'] as const,
  
  // Exchanges
  exchanges: ['exchanges'] as const,
  exchange: (id: string) => ['exchanges', id] as const,
  exchangeConnections: ['exchange-connections'] as const,
  
  // Market Data
  tickers: ['tickers'] as const,
  ticker: (symbol: string) => ['tickers', symbol] as const,
  candlesticks: (symbol: string, timeframe: Timeframe) => ['candlesticks', symbol, timeframe] as const,
  orderBook: (symbol: string) => ['order-book', symbol] as const,
  
  // Trading
  balance: ['balance'] as const,
  orders: ['orders'] as const,
  openOrders: ['orders', 'open'] as const,
  orderHistory: ['orders', 'history'] as const,
  positions: ['positions'] as const,
  trades: ['trades'] as const,
  tradeHistory: ['trades', 'history'] as const,
  
  // Signals
  signals: ['signals'] as const,
  activeSignals: ['signals', 'active'] as const,
  signalHistory: ['signals', 'history'] as const,
  
  // Alerts
  alerts: ['alerts'] as const,
  alertTriggers: ['alert-triggers'] as const,
  
  // Analytics
  portfolioPerformance: ['analytics', 'portfolio'] as const,
  tradingStats: ['analytics', 'trading'] as const,
  signalStats: ['analytics', 'signals'] as const,
  
  // Backtesting
  backtests: ['backtests'] as const,
  backtest: (id: string) => ['backtests', id] as const,
  
  // Notifications
  notifications: ['notifications'] as const,
  unreadNotifications: ['notifications', 'unread'] as const,
  
  // Admin
  allUsers: ['admin', 'users'] as const,
  systemStats: ['admin', 'stats'] as const,
} as const;

export type QueryKey = typeof QueryKeys[keyof typeof QueryKeys];