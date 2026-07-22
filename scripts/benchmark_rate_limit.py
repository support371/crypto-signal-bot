import time
import random
import threading
from typing import Dict, List, Optional
from collections import deque

class OriginalRateLimiter:
    def __init__(self, rpm=10000):
        self._rate_limit_window_seconds = 60
        self._rate_limit_max_requests = rpm
        self._rate_limit_store: Dict[str, List[float]] = {}
        self._store_lock = threading.Lock()

    def limit(self, client_ip: str) -> None:
        now: float = time.time()
        window_start: float = now - self._rate_limit_window_seconds

        with self._store_lock:
            # Evict stale IPs to prevent memory leak
            stale_keys = [
                ip for ip, ts_list in self._rate_limit_store.items()
                if not ts_list or ts_list[-1] <= window_start
            ]
            for key in stale_keys:
                del self._rate_limit_store[key]

            if client_ip not in self._rate_limit_store:
                self._rate_limit_store[client_ip] = []

            timestamps = self._rate_limit_store[client_ip]
            self._rate_limit_store[client_ip] = [t for t in timestamps if t > window_start]

            if len(self._rate_limit_store[client_ip]) >= self._rate_limit_max_requests:
                raise Exception("Rate limit exceeded")
            self._rate_limit_store[client_ip].append(now)


class OptimizedRateLimiter:
    def __init__(self, rpm=10000):
        self._rate_limit_window_seconds = 60
        self._rate_limit_max_requests = rpm
        self._rate_limit_store: Dict[str, deque[float]] = {}
        self._store_lock = threading.Lock()
        self._last_cleanup = time.time()
        self._cleanup_interval = 10.0  # Periodic cleanup every 10 seconds

    def limit(self, client_ip: str) -> None:
        now: float = time.time()
        window_start: float = now - self._rate_limit_window_seconds

        with self._store_lock:
            # Periodically evict stale IPs to keep memory bound
            if now - self._last_cleanup > self._cleanup_interval:
                stale_keys = [
                    ip for ip, q in self._rate_limit_store.items()
                    if not q or q[-1] <= window_start
                ]
                for key in stale_keys:
                    del self._rate_limit_store[key]
                self._last_cleanup = now

            if client_ip not in self._rate_limit_store:
                q = deque()
                self._rate_limit_store[client_ip] = q
            else:
                q = self._rate_limit_store[client_ip]

            # Lazy prune of stale timestamps for this IP
            while q and q[0] <= window_start:
                q.popleft()

            if len(q) >= self._rate_limit_max_requests:
                raise Exception("Rate limit exceeded")
            q.append(now)


def benchmark():
    num_ips = 100
    ips = [f"192.168.1.{i}" for i in range(num_ips)]
    requests = [random.choice(ips) for _ in range(50000)]

    orig = OriginalRateLimiter()
    opt = OptimizedRateLimiter()

    # Original
    start = time.perf_counter()
    for ip in requests:
        try:
            orig.limit(ip)
        except Exception:
            pass
    end = time.perf_counter()
    orig_time = end - start
    print(f"Original rate limiter: {orig_time:.6f} seconds ({orig_time / len(requests) * 1e6:.2f} us per request)")

    # Optimized
    start = time.perf_counter()
    for ip in requests:
        try:
            opt.limit(ip)
        except Exception:
            pass
    end = time.perf_counter()
    opt_time = end - start
    print(f"Optimized rate limiter: {opt_time:.6f} seconds ({opt_time / len(requests) * 1e6:.2f} us per request)")

    print(f"Improvement: {(orig_time - opt_time) / orig_time * 100:.2f}%")

if __name__ == "__main__":
    benchmark()
