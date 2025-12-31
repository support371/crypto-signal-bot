import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Simple in-memory cache
interface CacheEntry {
  data: CoinGeckoPrice;
  timestamp: number;
}

let priceCache: CacheEntry | null = null;
const CACHE_TTL = 30000; // 30 seconds

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('Unauthorized request - no auth header');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the JWT token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.log('Invalid token:', authError?.message);
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Authenticated user:', user.id);

    const { symbols } = await req.json();
    
    // Default symbols if none provided
    const coinIds = symbols || ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano', 'ripple', 'polkadot', 'avalanche-2', 'dogecoin', 'chainlink'];
    const cacheKey = coinIds.sort().join(',');
    
    // Check cache first
    if (priceCache && (Date.now() - priceCache.timestamp) < CACHE_TTL) {
      console.log('Returning cached price data');
      const prices = transformPriceData(priceCache.data, coinIds);
      return new Response(JSON.stringify({ prices, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Fetching fresh prices for:', coinIds.join(','));
    
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
      // If rate limited, return cached data if available
      if (response.status === 429 && priceCache) {
        console.log('Rate limited, returning stale cache');
        const prices = transformPriceData(priceCache.data, coinIds);
        return new Response(JSON.stringify({ prices, cached: true, rateLimited: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('CoinGecko API error:', response.status, await response.text());
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data: CoinGeckoPrice = await response.json();
    console.log('Received price data for', Object.keys(data).length, 'coins');
    
    // Update cache
    priceCache = {
      data,
      timestamp: Date.now(),
    };
    
    const prices = transformPriceData(data, coinIds);

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

function transformPriceData(data: CoinGeckoPrice, coinIds: string[]) {
  return Object.entries(data)
    .filter(([id]) => coinIds.includes(id))
    .map(([id, priceData]) => ({
      id,
      symbol: getCoinSymbol(id),
      name: getCoinName(id),
      price: priceData.usd,
      change24h: priceData.usd_24h_change,
      volume24h: priceData.usd_24h_vol,
      marketCap: priceData.usd_market_cap,
      lastUpdated: new Date().toISOString(),
    }));
}

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
