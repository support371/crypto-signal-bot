
import time
import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

# Mocking runtime config to avoid file system issues
os.environ["AUDIT_STORE_PATH"] = "backend/data/test_audit_store.json"

from backend.logic import audit_store

def setup_large_store(n=5000):
    audit_store.clear_audit()
    print(f"Seeding {n} traces...")
    # Faster seeding by manipulating the cache directly if possible,
    # but let's stick to the public API to be realistic.
    for i in range(n):
        audit_store.append_trace({
            "intent_id": f"intent_{i}",
            "symbol": "BTCUSDT" if i % 2 == 0 else "ETHUSDT",
            "execution": {"status": "completed" if i % 3 == 0 else "pending"},
            "timestamp": time.time()
        })
    print("Seeding complete.")

def benchmark():
    n = 5000
    setup_large_store(n)

    # Benchmark get_trace_by_intent_id (searching for a recent one)
    target_id = f"intent_{n-1}"
    start = time.perf_counter()
    for _ in range(100):
        trace = audit_store.get_trace_by_intent_id(target_id)
    end = time.perf_counter()
    print(f"get_trace_by_intent_id (recent): {(end - start)/100 * 1000:.4f} ms per call")

    # Benchmark get_trace_by_intent_id (searching for an old one)
    target_id = "intent_0"
    start = time.perf_counter()
    for _ in range(100):
        trace = audit_store.get_trace_by_intent_id(target_id)
    end = time.perf_counter()
    print(f"get_trace_by_intent_id (old): {(end - start)/100 * 1000:.4f} ms per call")

    # Benchmark get_traces (no filter, last 50)
    start = time.perf_counter()
    for _ in range(100):
        traces = audit_store.get_traces(limit=50)
    end = time.perf_counter()
    print(f"get_traces (no filter, limit=50): {(end - start)/100 * 1000:.4f} ms per call")

    # Benchmark get_traces (with filter, last 50)
    start = time.perf_counter()
    for _ in range(100):
        traces = audit_store.get_traces(symbol="BTCUSDT", limit=50)
    end = time.perf_counter()
    print(f"get_traces (symbol='BTCUSDT', limit=50): {(end - start)/100 * 1000:.4f} ms per call")

if __name__ == "__main__":
    benchmark()
    # Clean up
    if os.path.exists("backend/data/test_audit_store.json"):
        os.remove("backend/data/test_audit_store.json")
