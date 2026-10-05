import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BITGET_V3_READ_ONLY_CAPABILITIES,
  BitgetV3ReadOnlyAdapter,
} from '../src/live/adapters/bitget/v3/normalizer-v3.ts'
import { ExchangeContractError } from '../src/live/exchange-contracts.ts'

const OBSERVED_AT = '2026-10-05T10:30:00.000Z'
const EXPIRES_AT = '2026-10-06T10:30:00.000Z'

const ASSETS_FIXTURE = {
  code: '00000',
  msg: 'success',
  requestTime: 1746687063471,
  data: {
    accountEquity: '0.33',
    usdtEquity: '0.33',
    btcEquity: '0.000003',
    unrealisedPnl: '0',
    usdtUnrealisedPnl: '0',
    btcUnrealizedPnl: '0',
    effEquity: '0.33',
    mmr: '0',
    imr: '0',
    mgnRatio: '0',
    positionMgnRatio: '0',
    positionValue: '0',
    leverage: '1',
    assets: [
      {
        coin: 'BTC',
        equity: '0.000003',
        usdValue: '0.33',
        balance: '0.000003',
        available: '0.000003',
        debt: '0',
        locked: '0',
        bonus: '0',
      },
    ],
  },
}

const POSITION_ROW_FIXTURE = {
  category: 'USDT-FUTURES',
  symbol: 'BTCUSDT',
  marginCoin: 'USDT',
  holdMode: 'hedge_mode',
  posSide: 'long',
  marginMode: 'crossed',
  positionBalance: '100',
  available: '0.001',
  frozen: '0',
  total: '0.001',
  leverage: '3',
  curRealisedPnl: '0',
  avgPrice: '108674',
  positionStatus: 'normal',
  unrealisedPnl: '1.5',
  liquidationPrice: '43099.9',
  mmr: '0.015',
  profitRate: '0.01',
  markPrice: '118097',
  breakEvenPrice: '109208.6',
  totalFunding: '0',
  openFeeTotal: '0',
  closeFeeTotal: '0',
  cashDividend: '0',
  createdTime: '1736378720620',
  updatedTime: '1753102803148',
}

const INSTRUMENT_ROW_FIXTURE = {
  symbol: 'BTCUSDT',
  category: 'SPOT',
  baseCoin: 'BTC',
  quoteCoin: 'USDT',
  status: 'online',
  pricePrecision: '2',
  quantityPrecision: '6',
  quotePrecision: '6',
  minOrderQty: '0.00001',
  maxOrderQty: '',
  minOrderAmount: '1',
}

const adapter = new BitgetV3ReadOnlyAdapter()

test('V3 capabilities declare no execution authority', () => {
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.createOrder, false)
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.cancelOrder, false)
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.withdrawals, false)
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.deposits, false)
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.candidateExecutionEnabled, false)
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.accounts, true)
  assert.equal(BITGET_V3_READ_ONLY_CAPABILITIES.products, true)
})

test('V3 unified account snapshot maps margin fields and balances', () => {
  const snapshot = adapter.normalizeUnifiedAccount(ASSETS_FIXTURE, OBSERVED_AT)
  assert.equal(snapshot.accountEquityUsd, '0.33')
  assert.equal(snapshot.effectiveEquityUsd, '0.33')
  assert.equal(snapshot.maintenanceMarginUsd, '0')
  assert.equal(snapshot.initialMarginUsd, '0')
  assert.equal(snapshot.marginRatio, '0')
  assert.equal(snapshot.unrealisedPnlUsd, '0')
  assert.equal(snapshot.balances.length, 1)
  const balance = snapshot.balances[0]!
  assert.equal(balance.accountId, 'BITGET:UTA:BTC')
  assert.equal(balance.asset, 'BTC')
  assert.equal(balance.available, '0.000003')
  assert.equal(balance.held, '0')
  assert.equal(balance.active, true)
  assert.equal(balance.ready, true)
})

test('V3 unified account rejects malformed payloads', () => {
  assert.throws(
    () => adapter.normalizeUnifiedAccount({ data: { assets: 'nope' } }, OBSERVED_AT),
    (error: unknown) => error instanceof ExchangeContractError,
  )
  assert.throws(
    () => adapter.normalizeUnifiedAccount({ data: {} }, OBSERVED_AT),
    (error: unknown) => error instanceof ExchangeContractError,
  )
})

test('V3 product mapping derives increments from precisions', () => {
  const product = adapter.normalizeProduct(INSTRUMENT_ROW_FIXTURE, OBSERVED_AT, EXPIRES_AT)
  assert.equal(product.productId, 'BTC-USDT')
  assert.equal(product.baseAsset, 'BTC')
  assert.equal(product.quoteAsset, 'USDT')
  assert.equal(product.tradingEnabled, true)
  assert.equal(product.rules.baseIncrement, '0.000001')
  assert.equal(product.rules.priceIncrement, '0.01')
  assert.equal(product.rules.minimumBaseSize, '0.00001')
  assert.equal(product.rules.minimumQuoteSize, '1')
  assert.equal(product.rules.maximumBaseSize, null)
})

test('V3 product mapping marks offline instruments not trading', () => {
  const product = adapter.normalizeProduct(
    { ...INSTRUMENT_ROW_FIXTURE, status: 'offline' },
    OBSERVED_AT,
    EXPIRES_AT,
  )
  assert.equal(product.tradingEnabled, false)
})

test('V3 position mapping captures risk fields', () => {
  const position = adapter.normalizePosition(POSITION_ROW_FIXTURE)
  assert.equal(position.productId, 'BTC-USDT')
  assert.equal(position.category, 'USDT-FUTURES')
  assert.equal(position.symbol, 'BTCUSDT')
  assert.equal(position.side, 'long')
  assert.equal(position.size, '0.001')
  assert.equal(position.entryPrice, '108674')
  assert.equal(position.markPrice, '118097')
  assert.equal(position.unrealisedPnl, '1.5')
  assert.equal(position.liquidationPrice, '43099.9')
  assert.equal(position.marginMode, 'crossed')
  assert.equal(position.leverage, '3')
  assert.equal(position.createdAt, new Date(1736378720620).toISOString())
})

test('V3 position mapping nulls non-positive liquidation prices', () => {
  const position = adapter.normalizePosition({ ...POSITION_ROW_FIXTURE, liquidationPrice: '0' })
  assert.equal(position.liquidationPrice, null)
})

test('V3 position list rejects non-array lists', () => {
  assert.throws(
    () => adapter.normalizePositionList({ data: { list: 'nope' } }),
    (error: unknown) => error instanceof ExchangeContractError,
  )
  assert.deepEqual(adapter.normalizePositionList({ data: { list: [] } }), [])
})

test('V3 order and fill normalization are unsupported by construction', () => {
  assert.throws(
    () => adapter.normalizeOrder({}),
    (error: unknown) => error instanceof ExchangeContractError,
  )
  assert.throws(
    () => adapter.normalizeFill({}),
    (error: unknown) => error instanceof ExchangeContractError,
  )
})
