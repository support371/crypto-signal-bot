## 2025-05-15 - [Audit Store I/O Bottleneck]
**Learning:** File-backed stores that perform full read-modify-write cycles on every update become significantly slower as the file size grows. Cumulative I/O becomes O(n²) where n is the number of entries.
**Action:** Always implement in-memory caching for JSON-backed append-only stores to eliminate redundant reads and improve responsiveness. Remove indentation for internal persistence files to reduce disk footprint and write latency.

## 2025-05-20 - [Redundant DB Initialization]
**Learning:** Performing idempotent initialization (e.g., `CREATE TABLE IF NOT EXISTS`) on every call in high-frequency paths like logging is a performance drain due to repeated system calls and database locks.
**Action:** Use module-level memoization for store instances and internal `_initialized` flags to ensure expensive setup logic runs exactly once per process.
