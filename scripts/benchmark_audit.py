
import time
import uuid
import os
import json

# Set environment variable BEFORE importing audit_store
os.environ["AUDIT_STORE_PATH"] = "backend/data/audit_benchmark.json"

from backend.logic.audit_store import append_trace, get_traces, clear_audit

def benchmark_audit():
    print("Benchmarking Audit Store...")
    clear_audit()

    # Generate many traces
    num_traces = 5000
    print(f"Generating {num_traces} traces...")
    for i in range(num_traces):
        trace = {
            "intent_id": str(uuid.uuid4()),
            "symbol": "BTCUSDT" if i % 2 == 0 else "ETHUSDT",
            "execution": {"status": "completed" if i % 3 == 0 else "pending"},
            "timestamp": time.time()
        }
        append_trace(trace)

    print("Generation complete.")

    # Benchmark get_traces with symbol filter
    start = time.perf_counter()
    for _ in range(100):
        _ = get_traces(symbol="BTCUSDT", limit=50)
    end = time.perf_counter()
    print(f"get_traces (symbol='BTCUSDT', limit=50): {(end - start)/100:.6f}s per call")

    # Benchmark get_traces with no filter
    start = time.perf_counter()
    for _ in range(100):
        _ = get_traces(limit=50)
    end = time.perf_counter()
    print(f"get_traces (limit=50): {(end - start)/100:.6f}s per call")

if __name__ == "__main__":
    try:
        benchmark_audit()
    finally:
        if os.path.exists("backend/data/audit_benchmark.json"):
            os.remove("backend/data/audit_benchmark.json")
