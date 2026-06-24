import { describe, expect, it } from 'vitest'
import { FeedHealthRegistry } from '../../src/fast-path/feed-health'
import { classifyFreshness } from '../../src/fast-path/freshness'
import { normalizeCoinbaseMessage } from '../../src/fast-path/normalizers/coinbase'
import { DEFAULT_FAST_PATH_THRESHOLDS } from '../../src/fast-path/types'

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return Number(sorted[index].toFixed(4))
}

describe('fast-path local microbenchmark', () => {
  it('reports normalization, freshness, and registry update timing', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    const samples: number[] = []

    for (let sequence = 1; sequence <= 2000; sequence += 1) {
      const start = performance.now()
      const [event] = normalizeCoinbaseMessage({
        channel: 'l2_data',
        timestamp: 1_000 + sequence,
        sequence_num: sequence,
        events: [{
          type: 'update',
          product_id: 'BTC-USD',
          updates: [
            { side: 'bid', price_level: String(100 + sequence / 10_000), new_quantity: '2' },
            { side: 'offer', price_level: String(101 + sequence / 10_000), new_quantity: '3' },
          ],
        }],
      }, 1_000 + sequence)
      registry.ingest(event, 1_000 + sequence)
      classifyFreshness(20, true)
      samples.push(performance.now() - start)
    }

    const summary = {
      environment: 'vitest local runner; excludes network and platform latency',
      sample_count: samples.length,
      p50_ms: percentile(samples, 0.5),
      p95_ms: percentile(samples, 0.95),
      p99_ms: percentile(samples, 0.99),
    }
    console.info('FAST_PATH_LOCAL_BENCHMARK', JSON.stringify(summary))

    expect(summary.sample_count).toBe(2000)
    expect(summary.p50_ms).toBeGreaterThanOrEqual(0)
    expect(summary.p99_ms).toBeGreaterThanOrEqual(summary.p50_ms)
  })
})
