import type { DecisionMetricSample, PercentileSummary } from '../fast-path/types'

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return Number(sorted[index].toFixed(3))
}

function summarize(values: number[]): PercentileSummary {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  }
}

export function parseMetricWindowMs(window: string): number {
  const match = /^(\d+)(s|m|h)$/.exec(window)
  if (!match) return 15 * 60 * 1000
  const amount = Number(match[1])
  const multiplier = match[2] === 's' ? 1000 : match[2] === 'm' ? 60_000 : 3_600_000
  return Math.min(24 * 3_600_000, Math.max(1000, amount * multiplier))
}

export class DecisionMetricsStore {
  private readonly samples: DecisionMetricSample[] = []

  constructor(private readonly maxSamples = 5000) {}

  record(sample: DecisionMetricSample): void {
    this.samples.push(sample)
    while (this.samples.length > this.maxSamples) this.samples.shift()
  }

  clear(): void {
    this.samples.length = 0
  }

  snapshot(window = '15m', nowMs = Date.now()) {
    const cutoff = nowMs - parseMetricWindowMs(window)
    const samples = this.samples.filter((sample) => sample.recordedAtMs >= cutoff)
    const duplicateRejects = samples.filter((sample) => sample.duplicateRejected).length
    const staleRejects = samples.filter((sample) => sample.staleRejected).length
    return {
      version: '2.0' as const,
      generated_at: new Date(nowMs).toISOString(),
      window,
      sample_count: samples.length,
      decision_latency_ms: summarize(samples.map((sample) => sample.decisionLatencyMs)),
      decision_data_age_ms: summarize(samples.map((sample) => sample.decisionDataAgeMs)),
      duplicate_reject_rate: samples.length ? duplicateRejects / samples.length : null,
      stale_reject_rate: samples.length ? staleRejects / samples.length : null,
      ledger_atomicity_failures: 0,
      queue_projection_lag_ms: null,
      measurement_scope: samples.length ? 'ephemeral_worker_isolate' : 'not_reported',
    }
  }
}
