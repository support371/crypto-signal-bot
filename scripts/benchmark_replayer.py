import sys
import os
import time
import random
from dataclasses import dataclass

# Reproducible results
random.seed(42)

# Mocking modules that might cause import errors
from unittest.mock import MagicMock
sys.modules["fastapi"] = MagicMock()
sys.modules["pydantic"] = MagicMock()
sys.modules["pydantic_settings"] = MagicMock()

import importlib.util

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

# Load Replayer and its dependencies
load_module("backend.logic.indicators", "backend/logic/indicators.py")
load_module("backend.replay.replayer", "backend/replay/replayer.py")

from backend.replay.replayer import Replayer, ReplayCandle

def benchmark_replayer():
    print("Benchmarking Replayer.replay...")
    # Generate 1,000 candles
    candles = [
        ReplayCandle(
            timestamp=float(i * 3600),
            open=random.uniform(60000, 70000),
            high=random.uniform(70000, 71000),
            low=random.uniform(59000, 60000),
            close=random.uniform(60000, 70000),
            volume=random.uniform(1, 10)
        )
        for i in range(1000)
    ]

    replayer = Replayer()

    # Warm up
    replayer.replay("BTCUSDT", candles[:50])

    start = time.perf_counter()
    result = replayer.replay("BTCUSDT", candles)
    end = time.perf_counter()

    print(f"Replay for 1,000 candles took: {(end - start):.4f}s")
    print(f"Signals generated: {len(result.signals)}")
    print(f"Internal elapsed_ms: {result.elapsed_ms:.2f}ms")
    print(f"Output Hash: {result.output_hash}")

if __name__ == "__main__":
    benchmark_replayer()
