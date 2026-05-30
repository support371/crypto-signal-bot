
import httpx
import json
import asyncio

async def test_binance_batch():
    async with httpx.AsyncClient() as client:
        # Test 1: Single symbol (current behavior)
        resp = await client.get("https://api.binance.com/api/v3/ticker/24hr", params={"symbol": "BTCUSDT"})
        print(f"Single symbol status: {resp.status_code}")

        # Test 2: Multiple symbols (batch)
        symbols = ["BTCUSDT", "ETHUSDT"]
        resp = await client.get("https://api.binance.com/api/v3/ticker/24hr", params={"symbols": json.dumps(symbols)})
        print(f"Batch symbols status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"Batch data length: {len(data)}")
            print(f"Symbols returned: {[d['symbol'] for d in data]}")

if __name__ == "__main__":
    asyncio.run(test_binance_batch())
