
import asyncio
import json
import logging
from unittest.mock import AsyncMock, patch, MagicMock

# Set up path so we can import from backend
import sys
import os
sys.path.append(os.getcwd())

from backend.logic.market_data import BinancePublicMarketDataService

async def verify_batch_optimization():
    print("Starting verification of market data batch optimization...")

    symbols = ["BTCUSDT", "ETHUSDT"]
    service = BinancePublicMarketDataService(symbols=symbols)

    # Mock data for Binance response
    mock_ticker_data = [
        {
            "s": "BTCUSDT",
            "c": "60000",
            "P": "2.5",
            "q": "1000",
            "v": "0.01"
        },
        {
            "s": "ETHUSDT",
            "c": "3000",
            "P": "1.8",
            "q": "5000",
            "v": "1.5"
        }
    ]

    # Mock response for batch call
    # We need to mock .json() to return the data
    # And the mock_get itself should return a response-like object
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json = MagicMock(return_value=mock_ticker_data)
    mock_response.raise_for_status = MagicMock()

    # Async mock for the client.get
    mock_get = AsyncMock(return_value=mock_response)

    # Since the service creates its own client, we patch the class or the instance's method
    with patch("httpx.AsyncClient.get", mock_get):
        print(f"Calling _poll_once for {symbols}...")
        await service._poll_once()

        # VERIFICATION
        call_count = mock_get.call_count
        print(f"Total HTTP GET calls: {call_count}")

        if call_count == 1:
            print("✅ SUCCESS: Found exactly 1 HTTP request (Batching worked).")
            args, kwargs = mock_get.call_args
            url = args[0]
            params = kwargs.get("params", {})
            print(f"URL: {url}")
            print(f"Params: {params}")

            if "symbols" in params:
                requested_symbols = json.loads(params["symbols"])
                if set(requested_symbols) == set(symbols):
                    print("✅ SUCCESS: Batch symbols match requested symbols.")
                else:
                    print(f"❌ FAILURE: Symbols mismatch. Expected {symbols}, got {requested_symbols}")
            else:
                 print("❌ FAILURE: 'symbols' parameter not found in batch call.")

        else:
            print(f"❌ FAILURE: Expected 1 batch call, found {call_count}.")
            for i, call in enumerate(mock_get.call_args_list):
                print(f"  Call {i}: {call}")

if __name__ == "__main__":
    # Disable logging to keep output clean
    logging.getLogger("backend").setLevel(logging.ERROR)
    asyncio.run(verify_batch_optimization())
