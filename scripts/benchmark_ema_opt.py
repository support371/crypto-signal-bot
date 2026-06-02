import time
import random
from typing import List, Optional

def last_ema_old(values: List[float], period: int) -> Optional[float]:
    if not values or period <= 0:
        return None
    k = 2.0 / (period + 1)
    seed_idx = period - 1
    if len(values) < period:
        return None
    result = [None] * len(values)
    seed = sum(values[:period]) / period
    result[seed_idx] = seed
    prev = seed
    for i in range(seed_idx + 1, len(values)):
        val = values[i] * k + prev * (1 - k)
        result[i] = val
        prev = val
    return result[-1]

def last_ema_new(values: List[float], period: int) -> Optional[float]:
    if not values or period <= 0 or len(values) < period:
        return None
    k = 2.0 / (period + 1)
    current_ema = sum(values[:period]) / period
    for i in range(period, len(values)):
        current_ema = values[i] * k + current_ema * (1 - k)
    return current_ema

def benchmark():
    data = [random.uniform(100, 200) for _ in range(10000)]
    iterations = 1000

    start = time.time()
    for _ in range(iterations):
        last_ema_old(data, 20)
    print(f"Old last_ema: {time.time() - start:.4f}s")

    start = time.time()
    for _ in range(iterations):
        last_ema_new(data, 20)
    print(f"New last_ema: {time.time() - start:.4f}s")

if __name__ == "__main__":
    benchmark()
