import asyncio
import json
import time
import statistics
from typing import Any, Dict, List

# Mock WebSocket for benchmarking
class MockWebSocket:
    def __init__(self):
        self.sent_count = 0
        self.closed = False

    async def send_json(self, data: Any):
        if self.closed:
            raise Exception("Closed")
        # Simulate some minimal overhead of JSON serialization and sending
        json.dumps(data)
        self.sent_count += 1
        await asyncio.sleep(0.0001) # 100 microseconds simulate network/io

    async def send_text(self, text: str):
        if self.closed:
            raise Exception("Closed")
        self.sent_count += 1
        await asyncio.sleep(0.0001)

# Current implementation pattern
async def broadcast_sequential(clients: List[MockWebSocket], message: Dict[str, Any]):
    for ws in clients:
        try:
            await ws.send_json(message)
        except Exception:
            pass

# Optimized implementation pattern
async def broadcast_optimized(clients: List[MockWebSocket], message: Dict[str, Any]):
    if not clients:
        return
    text = json.dumps(message)
    tasks = []
    for ws in clients:
        tasks.append(ws.send_text(text))
    await asyncio.gather(*tasks, return_exceptions=True)

async def run_benchmark(client_count: int, iterations: int):
    print(f"Benchmarking with {client_count} clients, {iterations} iterations...")

    message = {"type": "ticker", "symbol": "BTCUSDT", "price": 60000.0, "timestamp": time.time()}

    # Sequential
    clients_seq = [MockWebSocket() for _ in range(client_count)]
    start_seq = time.perf_counter()
    for _ in range(iterations):
        await broadcast_sequential(clients_seq, message)
    end_seq = time.perf_counter()
    seq_time = end_seq - start_seq

    # Optimized
    clients_opt = [MockWebSocket() for _ in range(client_count)]
    start_opt = time.perf_counter()
    for _ in range(iterations):
        await broadcast_optimized(clients_opt, message)
    end_opt = time.perf_counter()
    opt_time = end_opt - start_opt

    print(f"Sequential: {seq_time:.4f}s total, {seq_time/iterations:.6f}s per broadcast")
    print(f"Optimized:  {opt_time:.4f}s total, {opt_time/iterations:.6f}s per broadcast")
    print(f"Improvement: {(seq_time - opt_time) / seq_time * 100:.2f}%")

if __name__ == "__main__":
    asyncio.run(run_benchmark(100, 50))
    print("-" * 20)
    asyncio.run(run_benchmark(500, 20))
