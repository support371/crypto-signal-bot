/**
 * Backend API Client for Crypto Signal Bot V2
 * 
 * This module provides all API functions that communicate with the backend.
 * In paper trading mode, all functions return mock data.
 * 
 * SECURITY: All live trading and withdrawal operations are blocked by the
 * operator boundary. This file only contains mock implementations.
 */

import {
  ApiResponse,
  PaginatedResponse,
  User,
  Exchange,
  ExchangeConnection,
  Ticker,
  Candlestick,
  OrderBook,
  Balance,
  Order,
  Trade,
  Position,
  Signal,
  Alert,
  AlertTrigger,
  Backtest,
  PortfolioPerformance,
  TradingStats,
  SignalStats,
  Timeframe,
  OrderSide,
  OrderType,
  OrderStatus,
  SignalType,
  SignalStrength,
} from './backendTypes';

import {
  enforceOperatorBoundary,
  enforceReadOnlyBoundary,
} from './operatorBoundary';

import {
  generateMockBalance,
  generateMockMarketData,
  generateMockOrders,
  generateMockSignals,
  generateMockTrades,
  generateMockExchangeData,
  markAsMock,
} from './paperSafety';

// ============================================================================
// Configuration
// ============================================================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000';

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchWithBoundary<T>(
  endpoint: string,
  options: RequestInit = {},
  operation: string
): Promise<ApiResponse<T>> {
  // SAFETY: Enforce operator boundary for all operations
  enforceOperatorBoundary(operation, { isPaper: true });
  
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    const data = await response.json();
    
    // SAFETY: Mark all responses as mock in paper trading mode
    if (import.meta.env.VITE_PAPER_TRADING_MODE === 'true') {
      return markAsMock({ ...data, isMock: true });
    }
    
    return data;
  } catch (error) {
    console.error(`API Error [${operation}]:`, error);
    return {
      success: false,
      error: `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString(),
      isMock: true,
    };
  }
}

// ============================================================================
// Authentication API
// ============================================================================

export const AuthApi = {
  async signIn(email: string, password: string): Promise<ApiResponse<User>> {
    enforceReadOnlyBoundary('sign_in');
    
    // Mock user for paper trading
    const mockUser: User = {
      id: 'mock-user-id',
      email: email || 'user@example.com',
      username: 'PaperTrader',
      role: 'trader',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      preferences: {
        theme: 'system',
        language: 'en',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notifications: {
          email: true,
          push: true,
          sms: false,
          telegram: false,
          discord: false,
          signalAlerts: true,
          priceAlerts: true,
          tradeNotifications: true,
        },
        dashboard: {
          defaultView: 'dashboard',
          widgets: [],
          layout: 'grid',
        },
      },
    };
    
    return markAsMock({
      success: true,
      data: mockUser,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async signUp(email: string, password: string, username: string): Promise<ApiResponse<User>> {
    enforceReadOnlyBoundary('sign_up');
    
    const mockUser: User = {
      id: `mock-user-${Date.now()}`,
      email,
      username,
      role: 'trader',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      preferences: {
        theme: 'system',
        language: 'en',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notifications: {
          email: true,
          push: true,
          sms: false,
          telegram: false,
          discord: false,
          signalAlerts: true,
          priceAlerts: true,
          tradeNotifications: true,
        },
        dashboard: {
          defaultView: 'dashboard',
          widgets: [],
          layout: 'grid',
        },
      },
    };
    
    return markAsMock({
      success: true,
      data: mockUser,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async signOut(): Promise<ApiResponse<null>> {
    enforceReadOnlyBoundary('sign_out');
    
    return markAsMock({
      success: true,
      data: null,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getCurrentUser(): Promise<ApiResponse<User>> {
    enforceReadOnlyBoundary('get_current_user');
    
    const mockUser: User = {
      id: 'mock-user-id',
      email: 'user@example.com',
      username: 'PaperTrader',
      role: 'trader',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      preferences: {
        theme: 'system',
        language: 'en',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notifications: {
          email: true,
          push: true,
          sms: false,
          telegram: false,
          discord: false,
          signalAlerts: true,
          priceAlerts: true,
          tradeNotifications: true,
        },
        dashboard: {
          defaultView: 'dashboard',
          widgets: [],
          layout: 'grid',
        },
      },
    };
    
    return markAsMock({
      success: true,
      data: mockUser,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Exchange API
// ============================================================================

export const ExchangeApi = {
  async getExchanges(): Promise<ApiResponse<Exchange[]>> {
    enforceReadOnlyBoundary('get_exchanges');
    
    const mockExchanges: Exchange[] = [
      {
        id: 'binance',
        name: 'Binance',
        type: 'centralized',
        status: 'connected',
        testNet: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'coinbase',
        name: 'Coinbase',
        type: 'centralized',
        status: 'connected',
        testNet: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'kraken',
        name: 'Kraken',
        type: 'centralized',
        status: 'connected',
        testNet: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'okx',
        name: 'OKX',
        type: 'centralized',
        status: 'connected',
        testNet: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    
    return markAsMock({
      success: true,
      data: mockExchanges,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getExchangeConnections(): Promise<ApiResponse<ExchangeConnection[]>> {
    enforceReadOnlyBoundary('get_exchange_connections');
    
    const mockConnections: ExchangeConnection[] = [
      {
        id: 'conn-binance-1',
        exchangeId: 'binance',
        userId: 'mock-user-id',
        status: 'connected',
        lastConnectedAt: new Date().toISOString(),
        rateLimitRemaining: 1000,
      },
      {
        id: 'conn-coinbase-1',
        exchangeId: 'coinbase',
        userId: 'mock-user-id',
        status: 'connected',
        lastConnectedAt: new Date().toISOString(),
        rateLimitRemaining: 1000,
      },
    ];
    
    return markAsMock({
      success: true,
      data: mockConnections,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async connectExchange(exchangeId: string): Promise<ApiResponse<ExchangeConnection>> {
    enforceOperatorBoundary('connect_exchange');
    
    // In paper trading mode, all exchanges are mock
    return markAsMock({
      success: true,
      data: {
        id: `conn-${exchangeId}-${Date.now()}`,
        exchangeId,
        userId: 'mock-user-id',
        status: 'connected',
        lastConnectedAt: new Date().toISOString(),
        rateLimitRemaining: 1000,
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async disconnectExchange(connectionId: string): Promise<ApiResponse<{ success: boolean }>> {
    enforceOperatorBoundary('disconnect_exchange');
    
    return markAsMock({
      success: true,
      data: { success: true },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Market Data API
// ============================================================================

export const MarketDataApi = {
  async getTickers(symbols?: string[]): Promise<ApiResponse<Ticker[]>> {
    enforceReadOnlyBoundary('get_tickers');
    
    const mockSymbols = symbols || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'ADA/USDT'];
    const mockTickers: Ticker[] = mockSymbols.map(symbol => ({
      ...generateMockMarketData(symbol),
      exchange: 'binance',
    }));
    
    return markAsMock({
      success: true,
      data: mockTickers,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getTicker(symbol: string): Promise<ApiResponse<Ticker>> {
    enforceReadOnlyBoundary('get_ticker');
    
    return markAsMock({
      success: true,
      data: {
        ...generateMockMarketData(symbol),
        exchange: 'binance',
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getCandlesticks(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100
  ): Promise<ApiResponse<Candlestick[]>> {
    enforceReadOnlyBoundary('get_candlesticks');
    
    const mockCandlesticks: Candlestick[] = Array.from({ length: limit }, (_, i) => ({
      timestamp: new Date(Date.now() - (limit - i) * 60000).toISOString(),
      open: 100 + Math.random() * 90000,
      high: 100 + Math.random() * 90000,
      low: 100 + Math.random() * 90000,
      close: 100 + Math.random() * 90000,
      volume: Math.random() * 1000000,
      symbol,
      timeframe,
    }));
    
    return markAsMock({
      success: true,
      data: mockCandlesticks,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getOrderBook(symbol: string, limit: number = 20): Promise<ApiResponse<OrderBook>> {
    enforceReadOnlyBoundary('get_order_book');
    
    const mockOrderBook: OrderBook = {
      symbol,
      exchange: 'binance',
      bids: Array.from({ length: limit }, (_, i) => [
        100 + Math.random() * 90000,
        Math.random() * 100
      ]),
      asks: Array.from({ length: limit }, (_, i) => [
        100 + Math.random() * 90000,
        Math.random() * 100
      ]),
      timestamp: new Date().toISOString(),
    };
    
    return markAsMock({
      success: true,
      data: mockOrderBook,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Trading API - READ ONLY in paper trading mode
// ============================================================================

export const TradingApi = {
  async getBalance(): Promise<ApiResponse<Balance>> {
    enforceReadOnlyBoundary('get_balance');
    
    return markAsMock({
      success: true,
      data: generateMockBalance(),
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getOrders(status?: OrderStatus): Promise<ApiResponse<Order[]>> {
    enforceReadOnlyBoundary('get_orders');
    
    return markAsMock({
      success: true,
      data: generateMockOrders(10),
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getOpenOrders(): Promise<ApiResponse<Order[]>> {
    enforceReadOnlyBoundary('get_open_orders');
    
    return markAsMock({
      success: true,
      data: generateMockOrders(5),
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getOrderHistory(limit: number = 50): Promise<ApiResponse<PaginatedResponse<Order>>> {
    enforceReadOnlyBoundary('get_order_history');
    
    return markAsMock({
      success: true,
      data: {
        data: generateMockOrders(limit),
        pagination: {
          page: 1,
          limit,
          total: limit,
          totalPages: 1,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getPositions(): Promise<ApiResponse<Position[]>> {
    enforceReadOnlyBoundary('get_positions');
    
    const mockPositions: Position[] = [
      {
        id: 'pos-1',
        userId: 'mock-user-id',
        symbol: 'BTC/USDT',
        side: 'BUY',
        entryPrice: 50000,
        amount: 0.5,
        leverage: 1,
        margin: 25000,
        currentPrice: 52000,
        unrealizedPnl: 1000,
        unrealizedPnlPercent: 4,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'pos-2',
        userId: 'mock-user-id',
        symbol: 'ETH/USDT',
        side: 'SELL',
        entryPrice: 3000,
        amount: 2,
        leverage: 1,
        margin: 6000,
        currentPrice: 2800,
        unrealizedPnl: 400,
        unrealizedPnlPercent: 6.67,
        createdAt: new Date(Date.now() - 43200000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    
    return markAsMock({
      success: true,
      data: mockPositions,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getTrades(limit: number = 50): Promise<ApiResponse<PaginatedResponse<Trade>>> {
    enforceReadOnlyBoundary('get_trades');
    
    return markAsMock({
      success: true,
      data: {
        data: generateMockTrades(limit),
        pagination: {
          page: 1,
          limit,
          total: limit,
          totalPages: 1,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getTradeHistory(limit: number = 50): Promise<ApiResponse<PaginatedResponse<Trade>>> {
    enforceReadOnlyBoundary('get_trade_history');
    
    return markAsMock({
      success: true,
      data: {
        data: generateMockTrades(limit),
        pagination: {
          page: 1,
          limit,
          total: limit,
          totalPages: 1,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  // SAFETY: Create order is BLOCKED by operator boundary
  async createOrder(
    symbol: string,
    side: OrderSide,
    type: OrderType,
    amount: number,
    price?: number
  ): Promise<ApiResponse<Order>> {
    enforceOperatorBoundary('create_order');
    
    // This should never be reached due to operator boundary
    return markAsMock({
      success: false,
      error: 'Live trading is disabled. All orders use mock data.',
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  // SAFETY: Cancel order is BLOCKED by operator boundary
  async cancelOrder(orderId: string): Promise<ApiResponse<Order>> {
    enforceOperatorBoundary('cancel_order');
    
    return markAsMock({
      success: false,
      error: 'Order modification is disabled in paper trading mode.',
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  // SAFETY: Withdraw is BLOCKED by operator boundary
  async withdraw(amount: number, currency: string, address: string): Promise<ApiResponse<{ success: boolean }>> {
    enforceOperatorBoundary('withdraw');
    
    return markAsMock({
      success: false,
      error: 'Withdrawals are disabled. This is a paper trading environment.',
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Signal API
// ============================================================================

export const SignalApi = {
  async getSignals(
    status?: SignalType,
    limit: number = 20
  ): Promise<ApiResponse<PaginatedResponse<Signal>>> {
    enforceReadOnlyBoundary('get_signals');
    
    const mockSignals = generateMockSignals(limit);
    
    return markAsMock({
      success: true,
      data: {
        data: mockSignals,
        pagination: {
          page: 1,
          limit,
          total: limit,
          totalPages: 1,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getActiveSignals(): Promise<ApiResponse<Signal[]>> {
    enforceReadOnlyBoundary('get_active_signals');
    
    return markAsMock({
      success: true,
      data: generateMockSignals(10),
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getSignalHistory(limit: number = 50): Promise<ApiResponse<PaginatedResponse<Signal>>> {
    enforceReadOnlyBoundary('get_signal_history');
    
    return markAsMock({
      success: true,
      data: {
        data: generateMockSignals(limit),
        pagination: {
          page: 1,
          limit,
          total: limit,
          totalPages: 1,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async executeSignal(signalId: string): Promise<ApiResponse<{ success: boolean; orderId?: string }>> {
    enforceOperatorBoundary('execute_signal');
    
    // In paper trading mode, signal execution is simulated
    return markAsMock({
      success: true,
      data: {
        success: true,
        orderId: `mock-order-${Date.now()}`,
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Alert API
// ============================================================================

export const AlertApi = {
  async getAlerts(): Promise<ApiResponse<Alert[]>> {
    enforceReadOnlyBoundary('get_alerts');
    
    const mockAlerts: Alert[] = [
      {
        id: 'alert-1',
        userId: 'mock-user-id',
        name: 'BTC Price Alert',
        type: 'PRICE',
        symbol: 'BTC/USDT',
        condition: 'ABOVE',
        value: 55000,
        isActive: true,
        notifyEmail: true,
        notifyPush: true,
        notifyTelegram: false,
        notifyDiscord: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'alert-2',
        userId: 'mock-user-id',
        name: 'ETH Price Alert',
        type: 'PRICE',
        symbol: 'ETH/USDT',
        condition: 'BELOW',
        value: 2500,
        isActive: true,
        notifyEmail: true,
        notifyPush: true,
        notifyTelegram: false,
        notifyDiscord: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    
    return markAsMock({
      success: true,
      data: mockAlerts,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async createAlert(alert: Omit<Alert, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<Alert>> {
    enforceOperatorBoundary('create_alert');
    
    const mockAlert: Alert = {
      ...alert,
      id: `alert-${Date.now()}`,
      userId: 'mock-user-id',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    return markAsMock({
      success: true,
      data: mockAlert,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async updateAlert(alertId: string, updates: Partial<Alert>): Promise<ApiResponse<Alert>> {
    enforceOperatorBoundary('update_alert');
    
    return markAsMock({
      success: true,
      data: {
        id: alertId,
        userId: 'mock-user-id',
        name: updates.name || 'Updated Alert',
        type: updates.type || 'PRICE',
        symbol: updates.symbol || 'BTC/USDT',
        condition: updates.condition || 'ABOVE',
        value: updates.value || 50000,
        isActive: updates.isActive ?? true,
        notifyEmail: updates.notifyEmail ?? true,
        notifyPush: updates.notifyPush ?? true,
        notifyTelegram: updates.notifyTelegram ?? false,
        notifyDiscord: updates.notifyDiscord ?? false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async deleteAlert(alertId: string): Promise<ApiResponse<{ success: boolean }>> {
    enforceOperatorBoundary('delete_alert');
    
    return markAsMock({
      success: true,
      data: { success: true },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getAlertTriggers(limit: number = 20): Promise<ApiResponse<PaginatedResponse<AlertTrigger>>> {
    enforceReadOnlyBoundary('get_alert_triggers');
    
    return markAsMock({
      success: true,
      data: {
        data: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Backtesting API
// ============================================================================

export const BacktestingApi = {
  async getBacktests(): Promise<ApiResponse<Backtest[]>> {
    enforceReadOnlyBoundary('get_backtests');
    
    return markAsMock({
      success: true,
      data: [],
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async createBacktest(backtest: Omit<Backtest, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<Backtest>> {
    enforceOperatorBoundary('create_backtest');
    
    const mockBacktest: Backtest = {
      ...backtest,
      id: `backtest-${Date.now()}`,
      userId: 'mock-user-id',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    return markAsMock({
      success: true,
      data: mockBacktest,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getBacktest(id: string): Promise<ApiResponse<Backtest>> {
    enforceReadOnlyBoundary('get_backtest');
    
    return markAsMock({
      success: true,
      data: {
        id,
        userId: 'mock-user-id',
        name: 'Sample Backtest',
        symbol: 'BTC/USDT',
        strategy: 'SMA_Crossover',
        timeframe: '1h',
        startDate: new Date(Date.now() - 30 * 86400000).toISOString(),
        endDate: new Date().toISOString(),
        initialBalance: 10000,
        status: 'COMPLETED',
        results: {
          totalTrades: 42,
          winningTrades: 28,
          losingTrades: 14,
          winRate: 66.67,
          totalProfit: 12500,
          totalProfitPercent: 125,
          maxDrawdown: 2500,
          maxDrawdownPercent: 25,
          sharpeRatio: 2.5,
          sortinoRatio: 3.0,
          profitFactor: 3.5,
          avgProfit: 446.43,
          avgLoss: 357.14,
          bestTrade: 2500,
          worstTrade: -1000,
          trades: [],
          equityCurve: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async cancelBacktest(id: string): Promise<ApiResponse<{ success: boolean }>> {
    enforceOperatorBoundary('cancel_backtest');
    
    return markAsMock({
      success: true,
      data: { success: true },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Analytics API
// ============================================================================

export const AnalyticsApi = {
  async getPortfolioPerformance(): Promise<ApiResponse<PortfolioPerformance>> {
    enforceReadOnlyBoundary('get_portfolio_performance');
    
    const mockPerformance: PortfolioPerformance = {
      totalValue: 125000,
      totalProfit: 25000,
      totalProfitPercent: 25,
      dailyChange: 500,
      dailyChangePercent: 0.4,
      weeklyChange: 2500,
      weeklyChangePercent: 2,
      monthlyChange: 10000,
      monthlyChangePercent: 10,
      yearlyChange: 25000,
      yearlyChangePercent: 25,
      bestPerformer: 'BTC/USDT',
      worstPerformer: 'ADA/USDT',
    };
    
    return markAsMock({
      success: true,
      data: mockPerformance,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getTradingStats(): Promise<ApiResponse<TradingStats>> {
    enforceReadOnlyBoundary('get_trading_stats');
    
    const mockStats: TradingStats = {
      totalTrades: 156,
      winningTrades: 102,
      losingTrades: 54,
      winRate: 65.38,
      profitFactor: 2.85,
      avgProfit: 250.50,
      avgLoss: -180.25,
      maxProfit: 5000,
      maxLoss: -1500,
      currentStreak: 5,
      bestStreak: 12,
    };
    
    return markAsMock({
      success: true,
      data: mockStats,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getSignalStats(): Promise<ApiResponse<SignalStats>> {
    enforceReadOnlyBoundary('get_signal_stats');
    
    const mockStats: SignalStats = {
      totalSignals: 245,
      accurateSignals: 189,
      accuracyRate: 77.14,
      avgConfidence: 0.82,
      signalsByType: {
        BUY: 120,
        SELL: 85,
        HOLD: 40,
      },
      signalsByStrength: {
        STRONG: 89,
        MEDIUM: 112,
        WEAK: 44,
      },
    };
    
    return markAsMock({
      success: true,
      data: mockStats,
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Notification API
// ============================================================================

export const NotificationApi = {
  async getNotifications(limit: number = 20): Promise<ApiResponse<PaginatedResponse<any>>> {
    enforceReadOnlyBoundary('get_notifications');
    
    return markAsMock({
      success: true,
      data: {
        data: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
        },
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async markAsRead(id: string): Promise<ApiResponse<{ success: boolean }>> {
    enforceOperatorBoundary('mark_notification_as_read');
    
    return markAsMock({
      success: true,
      data: { success: true },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async markAllAsRead(): Promise<ApiResponse<{ success: boolean }>> {
    enforceOperatorBoundary('mark_all_notifications_as_read');
    
    return markAsMock({
      success: true,
      data: { success: true },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// Admin API
// ============================================================================

export const AdminApi = {
  async getAllUsers(): Promise<ApiResponse<User[]>> {
    enforceOperatorBoundary('get_all_users');
    
    return markAsMock({
      success: true,
      data: [],
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
  
  async getSystemStats(): Promise<ApiResponse<any>> {
    enforceOperatorBoundary('get_system_stats');
    
    return markAsMock({
      success: true,
      data: {
        totalUsers: 1,
        activeUsers: 1,
        totalTrades: 0,
        totalVolume: 0,
        systemHealth: 'HEALTHY',
      },
      timestamp: new Date().toISOString(),
      isMock: true,
    });
  },
};

// ============================================================================
// WebSocket API
// ============================================================================

export const WebSocketApi = {
  getUrl(): string {
    return WS_BASE_URL;
  },
  
  getEvents(): string[] {
    return [
      'CONNECTED',
      'DISCONNECTED',
      'ERROR',
      'TICKER_UPDATE',
      'ORDER_BOOK_UPDATE',
      'SIGNAL_UPDATE',
      'TRADE_EXECUTED',
      'ORDER_UPDATE',
      'BALANCE_UPDATE',
      'ALERT_TRIGGERED',
    ];
  },
};

// ============================================================================
// Export all APIs
// ============================================================================

export const Api = {
  Auth: AuthApi,
  Exchange: ExchangeApi,
  MarketData: MarketDataApi,
  Trading: TradingApi,
  Signal: SignalApi,
  Alert: AlertApi,
  Backtesting: BacktestingApi,
  Analytics: AnalyticsApi,
  Notification: NotificationApi,
  Admin: AdminApi,
  WebSocket: WebSocketApi,
};

export default Api;