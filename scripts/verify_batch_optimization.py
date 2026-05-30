
import asyncio
import json
import logging
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

# Set up path so we can import from backend
import sys
import os
sys.path.append(os.getcwd())

from backend.services.market_data.service import get_price_batch, _get_adapters
from backend.adapters.exchanges.binance import BinanceAdapter

async def verify_optimization():
    print("Starting verification of batch optimization...")

    # Mock data for Binance response
    mock_ticker_data = [
        {
            "symbol": "BTCUSDT",
            "lastPrice": "60000",
            "bidPrice": "59990",
            "askPrice": "60010",
            "priceChangePercent": "2.5",
            "volume": "1000"
        },
        {
            "symbol": "ETHUSDT",
            "lastPrice": "3000",
            "bidPrice": "2995",
            "askPrice": "3005",
            "priceChangePercent": "1.8",
            "volume": "5000"
        }
    ]

    # Mock Response object
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.is_success = True
    mock_response.json.return_value = mock_ticker_data

    # Mock AsyncClient.get
    mock_get = AsyncMock(return_value=mock_response)

    # We need to make sure BinanceAdapter uses our mocked get
    with patch("httpx.AsyncClient.get", mock_get):
        # Also need to mock config so Binance is used and paper=True
        mock_cfg = MagicMock()
        mock_cfg.mode = "paper"
        mock_cfg.binance_api_key = "test"
        mock_cfg.binance_api_secret = "test"
        mock_cfg.binance_base_url = "https://api.binance.com"
        mock_cfg.binance_testnet = False

        # Primary adapter should be Binance
        with patch("backend.services.market_data.service.get_adapter", return_value=BinanceAdapter(paper=True)):
            with patch("backend.services.market_data.service.get_exchange_config", return_value=mock_cfg):
                # Clear cached adapters to force re-init with our mocks
                import backend.services.market_data.service as md_service
                md_service._cached_adapters = None

                symbols = ["BTCUSDT", "ETHUSDT"]
                print(f"Calling get_price_batch with {symbols}...")

                results = await get_price_batch(symbols)

                print(f"Results received: {len(results)} snapshots")
                for r in results:
                    print(f"  - {r.symbol}: {r.price} (Source: {r.source})")

                # VERIFICATION
                call_count = mock_get.call_count
                print(f"Total HTTP GET calls: {call_count}")

                # In the optimized version, it should be 1.
                # (Note: _get_adapters might call /ping for status if we are not careful,
                # but MarketDataService calls it lazily. Wait, BinanceAdapter.fetch_tickers doesn't call ping)

                # Find the call to /api/v3/ticker/24hr
                batch_calls = [
                    call for call in mock_get.call_args_list
                    if "/api/v3/ticker/24hr" in call.args[0] and "symbols" in call.kwargs.get("params", {})
                ]

                if len(batch_calls) == 1:
                    print("✅ SUCCESS: Found exactly 1 batch HTTP request.")
                    params = batch_calls[0].kwargs["params"]
                    print(f"Batch params: {params}")
                    if json.loads(params["symbols"]) == symbols:
                        print("✅ SUCCESS: Batch symbols match requested symbols.")
                    else:
                        print(f"❌ FAILURE: Symbols mismatch. Expected {symbols}, got {params['symbols']}")
                else:
                    print(f"❌ FAILURE: Expected 1 batch call, found {len(batch_calls)}.")
                    for i, call in enumerate(mock_get.call_args_list):
                        print(f"  Call {i}: {call}")

                if call_count == 1:
                    print("✅ SUCCESS: Only 1 network request total.")
                else:
                    print(f"⚠️ WARNING: {call_count} total requests made. (Optimized target was 1)")

if __name__ == "__main__":
    # Disable logging to keep output clean
    logging.getLogger("backend").setLevel(logging.ERROR)
    asyncio.run(verify_optimization())
