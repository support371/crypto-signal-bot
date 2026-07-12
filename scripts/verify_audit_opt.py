
import uuid
import os

# Set environment variable BEFORE importing audit_store
os.environ["AUDIT_STORE_PATH"] = "backend/data/audit_verify.json"

from backend.logic.audit_store import append_trace, get_traces, get_trace_by_intent_id, clear_audit

def verify_correctness():
    print("Verifying correctness of Audit Store optimizations...")
    clear_audit()

    # 1. Test basic get_traces (no filter)
    traces = []
    for i in range(100):
        t = {"intent_id": f"id_{i}", "symbol": "BTCUSDT" if i % 2 == 0 else "ETHUSDT", "val": i}
        append_trace(t)
        traces.append(t)

    # Should get last 10 in chronological order
    recent = get_traces(limit=10)
    assert len(recent) == 10
    assert recent[0]["val"] == 90
    assert recent[-1]["val"] == 99
    print("Basic get_traces passed.")

    # 2. Test get_traces with symbol filter
    # BTCUSDT are at 0, 2, 4, ..., 98
    # Last 5 BTCUSDT are 90, 92, 94, 96, 98
    btc_recent = get_traces(symbol="BTCUSDT", limit=5)
    assert len(btc_recent) == 5
    assert btc_recent[0]["val"] == 90
    assert btc_recent[-1]["val"] == 98
    print("Filtered get_traces passed.")

    # 3. Test get_trace_by_intent_id
    t_mid = get_trace_by_intent_id("id_50")
    assert t_mid["val"] == 50

    t_last = get_trace_by_intent_id("id_99")
    assert t_last["val"] == 99

    t_none = get_trace_by_intent_id("non_existent")
    assert t_none is None
    print("get_trace_by_intent_id passed.")

    # 4. Test limit larger than history
    all_btc = get_traces(symbol="BTCUSDT", limit=1000)
    assert len(all_btc) == 50
    assert all_btc[0]["val"] == 0
    assert all_btc[-1]["val"] == 98
    print("Large limit passed.")

    # 5. Test limit=0
    none_limit = get_traces(limit=0)
    assert len(none_limit) == 0

    none_limit_filtered = get_traces(symbol="BTCUSDT", limit=0)
    assert len(none_limit_filtered) == 0
    print("Limit=0 passed.")

if __name__ == "__main__":
    try:
        verify_correctness()
    finally:
        if os.path.exists("backend/data/audit_verify.json"):
            os.remove("backend/data/audit_verify.json")
