/**
 * Runs the Bitget UTA V3 read-only certification harness against mock fixtures
 * shaped from the UTA API docs and persists the evidence JSON.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings \
 *     worker/scripts/certify-bitget-v3-readonly.mjs [--out <path>]
 *
 * No credentials are used or required. No network access. Read-only fixtures only.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertBitgetV3ReadOnlyAuthorities } from '../src/live/adapters/bitget/v3/read-only-client-v3.ts'
import { runBitgetV3ReadOnlyCertification } from '../src/live/adapters/bitget/v3/v3-certification.ts'

const here = dirname(fileURLToPath(import.meta.url))
const defaultOut = resolve(here, '../tests/fixtures/bitget-v3-certification-evidence.json')
const outIndex = process.argv.indexOf('--out')
const outPath = outIndex >= 0 ? resolve(process.argv[outIndex + 1] ?? defaultOut) : defaultOut

const SETTINGS_FIXTURE = {
  code: '00000',
  msg: 'success',
  requestTime: 1746687063471,
  data: {
    uid: '6682030769',
    accountMode: 'unified',
    accountLevel: 'basic',
    assetMode: 'multi_assets',
    holdMode: 'one_way_mode',
  },
}

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

const POSITIONS_FIXTURE = {
  code: '00000',
  msg: 'success',
  requestTime: 1753103840140,
  data: {
    list: [
      {
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
      },
    ],
  },
}

const INSTRUMENTS_FIXTURE = {
  code: '00000',
  msg: 'success',
  requestTime: 1734766810918,
  data: [
    {
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
    },
  ],
}

const client = {
  async verifyReadOnlyPermissions() {
    return assertBitgetV3ReadOnlyAuthorities(SETTINGS_FIXTURE)
  },
  async getAccountAssets() {
    return ASSETS_FIXTURE
  },
  async getCurrentPositions() {
    return POSITIONS_FIXTURE
  },
  async getInstruments() {
    return INSTRUMENTS_FIXTURE
  },
  async request() {
    throw new Error('not used by mock client')
  },
}

const evaluatedAt = new Date().toISOString()
const result = await runBitgetV3ReadOnlyCertification({
  runId: `v3-cert-mock-${Date.now()}`,
  exchangeAccountId: 'BITGET:UTA:6682030769',
  observedAt: evaluatedAt,
  productExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  evaluatedAt,
  client,
})

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`)

const summary = result.checks
  .map((check) => `${check.name}=${check.status}`)
  .join(' ')
console.log(`status=${result.status} ${summary}`)
console.log(`evidence=${outPath}`)

if (result.status !== 'PASSED') process.exit(1)
