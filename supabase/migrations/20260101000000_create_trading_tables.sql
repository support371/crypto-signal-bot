-- Create signals table
CREATE TABLE public.signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    direction TEXT NOT NULL,
    confidence REAL NOT NULL,
    regime TEXT NOT NULL,
    horizon_minutes INTEGER NOT NULL,
    meta JSONB
);

-- Create posture_events table
CREATE TABLE public.posture_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL,
    reasons JSONB
);

-- Create execution_intents table
CREATE TABLE public.execution_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    intent_id TEXT UNIQUE NOT NULL,
    action TEXT NOT NULL,
    symbol TEXT NOT NULL,
    size_fraction REAL NOT NULL,
    reason TEXT,
    risk_score REAL
);

-- Create orders table
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    order_id TEXT UNIQUE NOT NULL,
    client_order_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL
);

-- Create execution_reports table
CREATE TABLE public.execution_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    venue_order_id TEXT NOT NULL,
    fill_id TEXT NOT NULL,
    client_order_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    timestamp BIGINT NOT NULL
);

-- Create portfolio_snapshots table
CREATE TABLE public.portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    nav REAL NOT NULL,
    exposure REAL NOT NULL,
    positions JSONB,
    balances JSONB,
    drawdown REAL
);

-- Create governance_state table
CREATE TABLE public.governance_state (
    id INTEGER PRIMARY KEY,
    trading_enabled BOOLEAN NOT NULL,
    is_frozen BOOLEAN NOT NULL,
    global_kill_switch BOOLEAN NOT NULL,
    strategy_kill_switches JSONB,
    venue_kill_switches JSONB
);

-- Create audit_events table
CREATE TABLE public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT UNIQUE NOT NULL,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    payload JSONB
);
