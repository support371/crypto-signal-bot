## 2025-05-15 - [Audit Store I/O Bottleneck]
**Learning:** File-backed stores that perform full read-modify-write cycles on every update become significantly slower as the file size grows. Cumulative I/O becomes O(n²) where n is the number of entries.
**Action:** Always implement in-memory caching for JSON-backed append-only stores to eliminate redundant reads and improve responsiveness. Remove indentation for internal persistence files to reduce disk footprint and write latency.

## 2026-05-24 - [Initialization-on-Every-Call Anti-pattern]
**Learning:** Performing idempotent initialization (like `CREATE TABLE IF NOT EXISTS`) on every function call introduces significant overhead in high-frequency paths. Even if the underlying system call is fast, the cumulative latency of thousands of redundant SQL executions and file system checks adds up.
**Action:** Use a simple boolean flag or memoization to ensure initialization logic runs exactly once per process lifetime, especially in logging or auditing components that are called frequently.

## 2026-05-29 - [Redundant API Round-trips in Exchange Adapters]
**Learning:** Some exchange endpoints (like Binance's 24hr ticker) provide a superset of data that makes other specialized endpoints (like bookTicker) redundant for common use cases. Consolidating these calls reduces network latency and saves API rate-limit weight.
**Action:** Always check the full response schema of "thick" API endpoints to see if they can replace multiple "thin" calls in hot paths like price fetching.

## 2026-06-03 - [Series-based Indicator "Last Value" Overhead]
**Learning:** Functions that calculate a full time series only to return the last value (e.g., `last_ema`) introduce significant memory and CPU overhead due to list allocation and redundant calculations. For $N$ candles, this is $O(N)$ space when $O(1)$ is possible.
**Action:** Always implement optimized "last-value" versions of technical indicators that skip list allocation and calculate the target value in a single pass. For Bollinger Bands, $O(period)$ is sufficient for the last bar, avoiding the $O(N)$ rolling sum logic.

## 2026-06-03 - [MACD Redundant Series Calculation]
**Learning:** Signal engines often need both current and previous bar values for crossover detection. Calling `last_macd` twice results in two full series calculations ($2 \times 2$ EMAs).
**Action:** Extend "last-value" indicators with a `count` parameter to allow fetching the last $K$ values in a single pass, drastically reducing the number of EMA calculations in strategy hot paths.

## 2026-06-10 - [Single-pass Iterative MACD]
**Learning:** Even with a `count` parameter, if `last_macd` calls the full series `macd` function, it still performs $O(N)$ space allocations and multiple passes. A true single-pass iterative implementation reduces space to $O(count)$ and halves CPU time by avoiding redundant list iterations and garbage collection pressure.
**Action:** Always implement technical indicators using iterative single-pass logic when only the most recent values are needed, rather than wrapping full-series calculations.

## 2026-06-17 - [Replayer & Backtest O(N^2) Windowing Bottleneck]
**Learning:** Iteratively calculating technical indicators on an expanding window for a full historical series results in $O(N^2)$ complexity. For long backtests or replays (e.g., 10,000 candles), this becomes exponentially slower.
**Action:** Always pre-calculate technical indicator series in a single $O(N)$ pass using batch functions (`ema`, `rsi`, `macd`, etc.) before entering the simulation or replay loop.

## 2026-06-24 - [Intermediate List Allocation in Series Indicators]
**Learning:** Functions like `rsi` and `atr` that calculate a full series often use intermediate list comprehensions (e.g., `changes`, `gains`, `losses`, `tr_list`). For large $N$, these allocations and subsequent iterations significantly increase memory pressure and execution time.
**Action:** Always implement series technical indicators using a single-pass O(N) loop that calculates all components (like True Range or Gains/Losses) on the fly, eliminating intermediate list storage. Use multiplicative inverses to replace division inside hot loops.

## 2026-07-01 - [RSI Correctness on Flat Series]
**Learning:** A common edge case in RSI implementations is a flat price series (zero gains and zero losses). If not handled explicitly, dividing by a zero average loss can lead to incorrect results (like 100.0) or errors. Technicially, if both gain and loss are zero, RSI should be 50.0.
**Action:** Always handle the `avg_loss == 0` case in RSI by checking if `avg_gain` is also zero; return 50.0 if both are zero, and 100.0 only if `avg_gain > 0`.

## 2026-07-08 - [CPython Loop & Arithmetic Micro-optimizations]
**Learning:** In CPython, the overhead of generator expressions (e.g., `sum(x**2 for x in window)`) and the general-purpose power operator (`**`) is significant in tight loops. Explicit `for` loops and simple multiplication (`x * x`) are much faster. Additionally, using the algebraically simplified EMA update rule `val += k * (input - val)` instead of the traditional weighted average reduces the number of operations per iteration.
**Action:** Favor explicit loops and basic arithmetic over functional constructs or complex operators in performance-critical indicator loops. Always use the simplified EMA formula for incremental updates.

## 2026-07-15 - [Indicator Loop Branch Elimination]
**Learning:** Checking for window readiness (e.g., `if i >= period`) inside a rolling window loop adds a redundant conditional branch to every iteration. For large datasets, this overhead accumulates.
**Action:** Unroll the "priming" phase of rolling window indicators into a separate loop. This allows the main loop to run branch-free, focusing exclusively on the core computation and window shifting.

## 2026-07-15 - [Efficient RSI Series Calculation]
**Learning:** The traditional RSI formula $100 - (100 / (1 + RS))$ involves multiple divisions and nested calculations. It can be simplified to $100 \cdot avg\_gain / (avg\_gain + avg\_loss)$, which is mathematically equivalent and significantly faster.
**Action:** Use the ratio-based RSI formula to reduce floating-point divisions and simplify the update logic inside hot loops.

## 2026-07-22 - [CPython Iterator-based Hot Loops]
**Learning:** In CPython, the overhead of integer indexing (`__getitem__`) in tight loops is measurable. Using `itertools.islice` and `zip` to create iterators for current and shifted values (e.g., `zip(islice(values, 1, None), values)`) is significantly faster than using `range(n)` and index lookups. Additionally, building result lists with `.append()` is slightly faster than pre-allocating and assigning by index in CPython 3.12.
**Action:** Always favor iterator-based patterns (`islice`, `zip`, `enumerate`) over index-based access in performance-critical calculation loops. Use `.append()` for incremental result list building unless fixed-size pre-allocation is strictly required by logic.
