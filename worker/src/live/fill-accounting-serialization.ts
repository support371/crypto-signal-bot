export class FillAccountingSerialQueue {
  private tail: Promise<void> = Promise.resolve()
  private queued = 0

  get pendingCount(): number {
    return this.queued
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof operation !== 'function') throw new TypeError('operation is required')

    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    this.queued += 1

    await previous
    try {
      return await operation()
    } finally {
      this.queued -= 1
      release()
    }
  }
}
