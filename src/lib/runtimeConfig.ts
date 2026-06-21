/**
 * Runtime configuration for the Crypto Signal Bot V2
 * All configuration is enforced at runtime to prevent tampering
 */

export interface RuntimeConfig {
  paperTradingMode: boolean;
  allowLiveTrading: boolean;
  allowWithdrawals: boolean;
  maxPositionSize: number;
  maxOpenPositions: number;
  supportedExchanges: string[];
  apiRateLimit: number;
  websocketEnabled: boolean;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  // SAFETY: Paper trading mode is ALWAYS enabled
  paperTradingMode: true,
  
  // SAFETY: Live trading is ALWAYS disabled
  allowLiveTrading: false,
  
  // SAFETY: Withdrawals are ALWAYS disabled
  allowWithdrawals: false,
  
  // Risk management
  maxPositionSize: 10000,
  maxOpenPositions: 10,
  
  // Supported exchanges
  supportedExchanges: ['binance', 'coinbase', 'kraken', 'okx'],
  
  // API rate limiting
  apiRateLimit: 100,
  
  // WebSocket
  websocketEnabled: true,
};

// Runtime configuration instance - cannot be modified after initialization
let runtimeConfig: RuntimeConfig = { ...DEFAULT_CONFIG };

/**
 * Initialize runtime configuration
 * Note: Paper trading mode and safety settings cannot be overridden
 */
export function initializeRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): void {
  // SAFETY: These settings CANNOT be overridden
  runtimeConfig = {
    ...overrides,
    // Force paper trading mode
    paperTradingMode: true,
    // Force disable live trading
    allowLiveTrading: false,
    // Force disable withdrawals
    allowWithdrawals: false,
  };
}

/**
 * Get the current runtime configuration
 */
export function getRuntimeConfig(): RuntimeConfig {
  return { ...runtimeConfig };
}

/**
 * Check if paper trading mode is enabled (always true)
 */
export function isPaperTradingMode(): boolean {
  return runtimeConfig.paperTradingMode;
}

/**
 * Check if live trading is allowed (always false)
 */
export function isLiveTradingAllowed(): boolean {
  return runtimeConfig.allowLiveTrading;
}

/**
 * Check if withdrawals are allowed (always false)
 */
export function areWithdrawalsAllowed(): boolean {
  return runtimeConfig.allowWithdrawals;
}

// Initialize with defaults
initializeRuntimeConfig();