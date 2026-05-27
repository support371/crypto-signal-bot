## 2025-05-15 - [Audit Store I/O Bottleneck]
**Learning:** File-backed stores that perform full read-modify-write cycles on every update become significantly slower as the file size grows. Cumulative I/O becomes O(n²) where n is the number of entries.
**Action:** Always implement in-memory caching for JSON-backed append-only stores to eliminate redundant reads and improve responsiveness. Remove indentation for internal persistence files to reduce disk footprint and write latency.

## 2025-05-27 - [Redundant Database Initialization]
**Learning:** Performing idempotent schema checks (e.g., `CREATE TABLE IF NOT EXISTS`) on every database operation introduces significant overhead, especially in high-frequency logging paths. Instantiating a new database store object for every operation prevents effective caching of initialization state.
**Action:** Use an `_initialized` flag within database store classes to ensure schema checks run once per instance. Memoize or use a singleton pattern for store instances to minimize both object creation and redundant initialization overhead.
