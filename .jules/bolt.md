## 2025-05-15 - [Audit Store I/O Bottleneck]
**Learning:** File-backed stores that perform full read-modify-write cycles on every update become significantly slower as the file size grows. Cumulative I/O becomes O(n²) where n is the number of entries.
**Action:** Always implement in-memory caching for JSON-backed append-only stores to eliminate redundant reads and improve responsiveness. Remove indentation for internal persistence files to reduce disk footprint and write latency.

## 2026-05-24 - [Initialization-on-Every-Call Anti-pattern]
**Learning:** Performing idempotent initialization (like `CREATE TABLE IF NOT EXISTS`) on every function call introduces significant overhead in high-frequency paths. Even if the underlying system call is fast, the cumulative latency of thousands of redundant SQL executions and file system checks adds up.
**Action:** Use a simple boolean flag or memoization to ensure initialization logic runs exactly once per process lifetime, especially in logging or auditing components that are called frequently.

## 2026-05-29 - [Redundant API Round-trips in Exchange Adapters]
**Learning:** Some exchange endpoints (like Binance's 24hr ticker) provide a superset of data that makes other specialized endpoints (like bookTicker) redundant for common use cases. Consolidating these calls reduces network latency and saves API rate-limit weight.
**Action:** Always check the full response schema of "thick" API endpoints to see if they can replace multiple "thin" calls in hot paths like price fetching.
