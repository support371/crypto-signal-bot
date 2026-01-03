# Architecture

This document outlines the current and target architecture of the Lovable AI Crypto Risk Agent platform.

## Current Architecture (Paper/Sim Mode)

The current system operates as two disconnected applications: a frontend simulation and a backend simulation.

**Components:**

1.  **Frontend (React/Vite):** A self-contained, in-browser simulation.
    *   **Data Source:** Fetches real-time cryptocurrency prices from a Supabase Edge Function (`crypto-prices`), which in turn calls the public CoinGecko API.
    *   **Logic:** Implements its own signal generation, risk assessment, and microstructure feature simulation entirely in TypeScript (`src/hooks/useSignalEngine.ts`).
    *   **Backend Interaction:** None. The frontend does not communicate with the Python backend.
    *   **Persistence:** User settings and paper trading portfolios are persisted in a Supabase Postgres database.

2.  **Backend (Python/FastAPI):** An independent, stateless API that provides a similar, but unused, simulation.
    *   **Pipeline:** `logic/features.py` → `logic/signals.py` → `logic/risk.py`.
    *   **Entrypoints:** Exposes `/analyze-features` and `/simulate-session` endpoints.
    *   **State:** The backend is entirely stateless and does not persist any data.

3.  **Supabase:** Provides supporting cloud services.
    *   **Authentication:** Manages user login and sessions for the frontend.
    *   **Database:** Hosts a Postgres database for user-specific application data (portfolios, settings).
    *   **Edge Functions:** Runs a serverless function to fetch market data from CoinGecko.

**Data Flow Diagram (Current):**

```
[CoinGecko API] -> [Supabase Edge Function] -> [Frontend React App (Full Simulation)] -> [Supabase DB]

[Python Backend (Unused Simulation)]
```

## Target Architecture (Real-Money Automated Trading Pipeline)

The goal is to evolve the system into a robust, production-grade automated trading platform by integrating the backend and frontend and adding several new, safety-critical modules. The existing, proven logic from `backend/logic/*` will be preserved and wrapped by the new pipeline.

**Core Principles:**

*   **Safety First:** Live trading is disabled by default and protected by multiple layers of governance.
*   **Explainability:** Every action is auditable, with a clear trace chain from data to execution.
*   **Modularity:** Each component has a single, well-defined responsibility, with clear, typed contracts for data handoffs.
*   **Authoritative State:** The system maintains its own authoritative state for portfolios and orders, which is continuously reconciled against the exchange.

**New Backend Modules:**

1.  **Contracts:** Pydantic models defining the strict schemas for all data passed between modules.
2.  **Governance:** Manages kill switches, the master `TRADING_ENABLED` flag, and a "freeze" mode that can be latched by other modules. Acts as the final gatekeeper before any execution call.
3.  **Posture:** Computes a market-wide posture (GREEN/AMBER/RED) based on signal quality, data freshness, and volatility. Provides a high-level "permission slip" for the Intent Builder.
4.  **Intent Builder:** The core "portfolio architect" bot. It consumes the `Signal` (from `backend/logic`), `MarketPosture`, and `PortfolioState` to generate a high-level `ExecutionIntent` (e.g., "ENTER LONG 0.1 BTC"). It is responsible for all sizing, risk capping, and hard-limit enforcement.
5.  **OMS (Order Management System):** A state machine that manages the lifecycle of orders. It consumes `ExecutionIntent`s and is responsible for idempotency, ensuring one intent never results in duplicate exchange orders.
6.  **Execution Gateway:** A thin abstraction layer over the exchange API (e.g., Bitget). Its only job is to translate normalized internal orders into exchange-specific requests and normalize exchange responses.
7.  **Portfolio:** The authoritative source of truth for all positions, balances, and PnL. It updates its state *only* from confirmed `ExecutionReport`s from the gateway.
8.  **Reconciliation:** A periodic job that compares the internal `Portfolio` state with the actual state reported by the exchange. If a persistent mismatch is detected, it triggers the Governance "freeze" mode.
9.  **Audit:** An append-only logger that records every significant event in the pipeline, creating an immutable trace chain for every decision.

**Data Flow Diagram (Target):**

```
[Market Data]
      |
      v
[backend/logic/*] -> [Signal]
      |
      v
[Posture Engine] -> [MarketPosture]
      |
      v
[Intent Builder] -> [ExecutionIntent]  <-- [PortfolioState]
      |
      v
[OMS] -> [OrderUpdate]
      |
      v
[Governance Gate] -> (assert_trading_allowed)
      |
      v
[Execution Gateway] -> [Exchange API]
      |
      v
[ExecutionReport]
      |
      v
[Portfolio Manager] -> [PortfolioState] -> (feeds back to Intent Builder)
      |
      v
[Reconciliation Engine] <-> [Exchange API]
      |
      v
(on mismatch) -> [Governance Gate] -> (FREEZE)

----------------------------------------------------
[Audit Logger] <- (receives events from all modules)
----------------------------------------------------
      |
      v
[Supabase DB (New Tables)]
      |
      v
[Backend API Endpoints]
      |
      v
[Frontend Dashboard]
```
