
import time
import os
import sys

# Add repository root to PYTHONPATH
sys.path.append(os.getcwd())

from backend.logic.audit_store import append_trace, get_traces, clear_audit

def benchmark_audit_store():
    print("Seeding audit store with 10,000 traces...")
    clear_audit()
    for i in range(10000):
        append_trace({
            "intent_id": f"intent-{i}",
            "symbol": "BTCUSDT" if i % 2 == 0 else "ETHUSDT",
            "execution": {"status": "completed" if i % 3 == 0 else "failed"},
            "timestamp": time.time()
        })

    print("Benchmarking get_traces (limit=50)...")

    # Warmup
    for _ in range(10):
        _ = get_traces(limit=50)

    start = time.perf_counter()
    iterations = 100
    for _ in range(iterations):
        _ = get_traces(limit=50)
    end = time.perf_counter()

    avg_time = (end - start) / iterations
    print(f"get_traces (10k entries, limit=50): {avg_time*1000:.4f} ms per call")

    print("Benchmarking get_traces with symbol filter (limit=50)...")
    start = time.perf_counter()
    for _ in range(iterations):
        _ = get_traces(symbol="BTCUSDT", limit=50)
    end = time.perf_counter()

    avg_time_filter = (end - start) / iterations
    print(f"get_traces with filter (10k entries, limit=50): {avg_time_filter*1000:.4f} ms per call")

if __name__ == "__main__":
    benchmark_audit_store()
