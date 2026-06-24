import { classifySequence } from './events'
import {
  DEFAULT_FAST_PATH_THRESHOLDS,
  type FastPathThresholds,
  type NormalizedMarketEvent,
  type RecoveryState,
} from './types'

export interface RecoveryApplyResult {
  state: RecoveryState
  accepted: NormalizedMarketEvent[]
  rejected: NormalizedMarketEvent[]
  lastSequence: number | null
  errorCode: string | null
}

export class BinanceDepthRecovery {
  private state: RecoveryState = 'idle'
  private startedAtMs: number | null = null
  private lastSequence: number | null = null
  private readonly buffer: NormalizedMarketEvent[] = []

  constructor(private readonly thresholds: FastPathThresholds = { ...DEFAULT_FAST_PATH_THRESHOLDS }) {}

  begin(nowMs: number): void {
    this.state = 'loading_snapshot'
    this.startedAtMs = nowMs
    this.lastSequence = null
    this.buffer.length = 0
  }

  bufferDelta(event: NormalizedMarketEvent, nowMs: number): RecoveryState {
    this.expireIfNeeded(nowMs)
    if (this.state === 'unavailable') return this.state
    if (this.state === 'idle') this.begin(nowMs)
    this.state = 'buffering'
    this.buffer.push(event)
    this.buffer.sort((a, b) => (a.sequenceStart ?? a.sequenceEnd ?? 0) - (b.sequenceStart ?? b.sequenceEnd ?? 0))
    while (this.buffer.length > this.thresholds.maxBufferedEvents) this.buffer.shift()
    return this.state
  }

  applySnapshot(lastUpdateId: number, nowMs: number): RecoveryApplyResult {
    this.expireIfNeeded(nowMs)
    if (this.state === 'unavailable') {
      return this.result([], [...this.buffer], 'RECOVERY_TIMEOUT')
    }

    this.state = 'bridging'
    const accepted: NormalizedMarketEvent[] = []
    const rejected: NormalizedMarketEvent[] = []
    let sequence = lastUpdateId
    let bridged = false

    for (const event of this.buffer) {
      const start = event.sequenceStart ?? event.sequenceEnd
      const end = event.sequenceEnd ?? event.sequenceStart
      if (start === undefined || end === undefined) {
        rejected.push(event)
        continue
      }
      if (end <= sequence) {
        rejected.push(event)
        continue
      }
      const relation = classifySequence(sequence, start, end)
      if (!bridged) {
        if (start <= sequence + 1 && end >= sequence + 1) {
          accepted.push(event)
          sequence = end
          bridged = true
          continue
        }
        rejected.push(event)
        continue
      }
      if (relation === 'continuous') {
        accepted.push(event)
        sequence = end
        continue
      }
      if (relation === 'duplicate' || relation === 'out_of_order') {
        rejected.push(event)
        continue
      }
      this.state = 'resyncing'
      this.lastSequence = sequence
      return this.result(accepted, rejected.concat(event), 'SEQUENCE_GAP')
    }

    if (!bridged) {
      this.state = 'resyncing'
      this.lastSequence = lastUpdateId
      return this.result([], [...this.buffer], 'SNAPSHOT_BRIDGE_NOT_FOUND')
    }

    this.state = 'healthy'
    this.lastSequence = sequence
    this.startedAtMs = null
    this.buffer.length = 0
    return this.result(accepted, rejected, null)
  }

  tick(nowMs: number): RecoveryState {
    this.expireIfNeeded(nowMs)
    return this.state
  }

  reset(): void {
    this.state = 'idle'
    this.startedAtMs = null
    this.lastSequence = null
    this.buffer.length = 0
  }

  getState(): RecoveryState {
    return this.state
  }

  getLastSequence(): number | null {
    return this.lastSequence
  }

  getBufferedCount(): number {
    return this.buffer.length
  }

  private expireIfNeeded(nowMs: number): void {
    if (this.startedAtMs === null) return
    if (nowMs - this.startedAtMs <= this.thresholds.recoveryTimeoutMs) return
    this.state = 'unavailable'
  }

  private result(
    accepted: NormalizedMarketEvent[],
    rejected: NormalizedMarketEvent[],
    errorCode: string | null,
  ): RecoveryApplyResult {
    return {
      state: this.state,
      accepted,
      rejected,
      lastSequence: this.lastSequence,
      errorCode,
    }
  }
}
