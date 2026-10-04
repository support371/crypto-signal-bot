export async function readBoundedResponseBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
  error: (reason: string, status: number) => Error,
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw error('provider_content_length_is_invalid', response.status)
    }
    if (parsedLength > maxResponseBytes) {
      throw error('provider_response_exceeds_size_limit', response.status)
    }
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let aborted = false
  const abortReader = () => {
    aborted = true
    void reader.cancel('response deadline exceeded').catch(() => undefined)
  }
  signal.addEventListener('abort', abortReader, { once: true })
  if (signal.aborted) abortReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (aborted) {
        throw error('demo_response_timed_out', response.status)
      }
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) {
        void reader.cancel('response byte limit exceeded').catch(() => undefined)
        throw error('provider_response_exceeds_size_limit', response.status)
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
}

