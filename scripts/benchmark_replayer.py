
import time
import random
from backend.replay.replayer import Replayer, ReplayCandle

def main():
    replayer = Replayer()
    symbol = "BTCUSDT"

    # Generate 1000 mock candles deterministically
    random.seed(42)
    candles = []
    now = 1600000000.0
    for i in range(1000):
        candles.append(ReplayCandle(
            timestamp=now + i * 60,
            open=50000.0 + random.random() * 100,
            high=50100.0 + random.random() * 100,
            low=49900.0 + random.random() * 100,
            close=50000.0 + random.random() * 100,
            volume=1.0 + random.random()
        ))

    print(f"Benchmarking Replayer.replay with {len(candles)} candles...")

    start_time = time.time()
    result = replayer.replay(symbol, candles)
    end_time = time.time()

    duration = end_time - start_time
    print(f"Replay took {duration:.4f} seconds")
    print(f"Signals generated: {len(result.signals)}")
    print(f"Output hash: {result.output_hash}")

if __name__ == "__main__":
    main()
