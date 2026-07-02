
import time
import random
import itertools
from backend.logic.indicators import bollinger_bands

def original_bollinger_bands(
    values: list[float],
    period: int = 20,
    num_std: float = 2.0,
):
    import math
    n = len(values)
    upper = [None] * n
    middle = [None] * n
    lower = [None] * n
    if n < period or period <= 0:
        return upper, middle, lower
    inv_period = 1.0 / period
    current_sum = 0.0
    current_sq_sum = 0.0
    for i in range(period - 1):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val
    for i in range(period - 1, n):
        val = values[i]
        current_sum += val
        current_sq_sum += val * val
        sma = current_sum * inv_period
        variance = (current_sq_sum * inv_period) - (sma * sma)
        std = math.sqrt(max(variance, 0.0))
        middle[i] = sma
        offset = num_std * std
        upper[i] = sma + offset
        lower[i] = sma - offset
        old_val = values[i - period + 1]
        current_sum -= old_val
        current_sq_sum -= old_val * old_val
    return upper, middle, lower

def verify():
    n = 1000
    period = 20
    values = [random.uniform(100, 200) for _ in range(n)]

    u1, m1, l1 = original_bollinger_bands(values, period)
    u2, m2, l2 = bollinger_bands(values, period)

    for i in range(n):
        v1 = (u1[i], m1[i], l1[i])
        v2 = (u2[i], m2[i], l2[i])
        for a, b in zip(v1, v2):
            if a is None or b is None:
                if a != b:
                    print(f"Mismatch at index {i}: {v1} != {v2}")
                    return False
            elif abs(a - b) > 1e-9:
                print(f"Mismatch at index {i}: {v1} != {v2}")
                return False
    print("Bollinger Bands verification passed!")
    return True

if __name__ == "__main__":
    verify()
