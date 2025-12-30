import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CoinGeckoPrice {
  [key: string]: {
    usd: number;
    usd_24h_change: number;
    usd_24h_vol: number;
    usd_market_cap: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { symbols } = await req.json();
    
    // Default symbols if none provided
    const coinIds = symbols || ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano', 'ripple', 'polkadot', 'avalanche-2', 'dogecoin', 'chainlink'];
    
    console.log('Fetching prices for:', coinIds.join(','));
    
    // Fetch from CoinGecko API (free tier)
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('CoinGecko API error:', response.status, await response.text());
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data: CoinGeckoPrice = await response.json();
    console.log('Received price data for', Object.keys(data).length, 'coins');
    
    // Transform data to our format
    const prices = Object.entries(data).map(([id, priceData]) => ({
      id,
      symbol: getCoinSymbol(id),
      name: getCoinName(id),
      price: priceData.usd,
      change24h: priceData.usd_24h_change,
      volume24h: priceData.usd_24h_vol,
      marketCap: priceData.usd_market_cap,
      lastUpdated: new Date().toISOString(),
    }));

    return new Response(JSON.stringify({ prices }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in crypto-prices function:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function getCoinSymbol(id: string): string {
  const symbols: Record<string, string> = {
    'bitcoin': 'BTC',
    'ethereum': 'ETH',
    'solana': 'SOL',
    'binancecoin': 'BNB',
    'cardano': 'ADA',
    'ripple': 'XRP',
    'polkadot': 'DOT',
    'avalanche-2': 'AVAX',
    'dogecoin': 'DOGE',
    'chainlink': 'LINK',
    'polygon': 'MATIC',
    'litecoin': 'LTC',
    'uniswap': 'UNI',
    'cosmos': 'ATOM',
    'stellar': 'XLM',
  };
  return symbols[id] || id.toUpperCase().slice(0, 4);
}

function getCoinName(id: string): string {
  const names: Record<string, string> = {
    'bitcoin': 'Bitcoin',
    'ethereum': 'Ethereum',
    'solana': 'Solana',
    'binancecoin': 'BNB',
    'cardano': 'Cardano',
    'ripple': 'XRP',
    'polkadot': 'Polkadot',
    'avalanche-2': 'Avalanche',
    'dogecoin': 'Dogecoin',
    'chainlink': 'Chainlink',
    'polygon': 'Polygon',
    'litecoin': 'Litecoin',
    'uniswap': 'Uniswap',
    'cosmos': 'Cosmos',
    'stellar': 'Stellar',
  };
  return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
}
