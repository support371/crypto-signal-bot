# Frontend Structure

> React + TypeScript + Vite SPA with Tailwind CSS and ShadCN/Radix UI.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite (with `@vitejs/plugin-react-swc`) |
| Styling | Tailwind CSS + `tailwindcss-animate` |
| Components | ShadCN/Radix UI primitives |
| Charts | Recharts |
| Routing | React Router DOM |
| Data Fetching | TanStack React Query + custom hooks |
| Auth | Supabase JS (`@supabase/supabase-js`) |
| Form Handling | React Hook Form + Zod validation |

## Directory Layout

```
src/
├── pages/                    # Route-level page components
│   ├── Index.tsx             # Main dashboard (authenticated)
│   ├── PublicHome.tsx        # Public landing page
│   ├── Auth.tsx              # Supabase auth page
│   ├── Waitlist.tsx          # Waitlist signup form
│   ├── IntegrationsStatus.tsx # Integration health monitor
│   └── NotFound.tsx          # 404 page
│
├── components/
│   ├── dashboard/            # Dashboard panel components
│   │   ├── Header.tsx        # Top navigation bar
│   │   ├── PortfolioPanel.tsx  # Balances and positions
│   │   ├── SignalPanel.tsx   # Signal classification display
│   │   ├── GuardianPanel.tsx # Kill-switch and guardian status
│   │   ├── EarningsPanel.tsx # P&L summary
│   │   ├── AuditTrailPanel.tsx # Activity stream
│   │   ├── PriceChart.tsx    # Price chart (Recharts)
│   │   ├── PriceTicker.tsx   # Real-time price ticker
│   │   ├── RiskGauge.tsx     # Risk visualization
│   │   ├── SystemMetricsPanel.tsx # Health and metrics
│   │   ├── AIInsightCard.tsx # AI insight display
│   │   ├── IndicatorToggles.tsx # Toggle controls
│   │   ├── MicrostructureDisplay.tsx # Market microstructure
│   │   └── SettingsModal.tsx # User settings dialog
│   │
│   ├── ui/                   # ShadCN primitives (~50 components)
│   │   ├── button.tsx, card.tsx, dialog.tsx, ...
│   │   └── (auto-generated via shadcn CLI)
│   │
│   ├── AuthBanner.tsx        # Auth status banner
│   ├── BackendUnavailable.tsx # Backend down fallback
│   ├── ErrorBoundary.tsx     # React error boundary
│   ├── NavLink.tsx           # Navigation link component
│   ├── ProtectedRoute.tsx    # Auth route guard
│   └── SetupRequired.tsx     # First-run setup prompt
│
├── hooks/                    # Custom React hooks
│   ├── useBackendStatus.ts   # Backend health polling
│   ├── useBackendWebSocket.ts # WebSocket connection
│   ├── useBackendMetrics.ts  # System metrics
│   ├── usePortfolio.ts       # Balance and position data
│   ├── useSignalEngine.ts    # Signal classification data
│   ├── useGuardianStatus.ts  # Guardian/kill-switch state
│   ├── useEarnings.ts        # P&L data
│   ├── useAuditTrail.ts      # Audit log data
│   ├── useCryptoPrices.ts    # Price data
│   ├── useAIInsights.ts      # AI insight data
│   ├── usePersistedSettings.ts # localStorage settings
│   └── use-toast.ts          # Toast notification hook
│
├── contexts/                 # React context providers
│   └── AuthContext.tsx        # Supabase auth state
│
├── context/                  # (Legacy) context directory
│
├── integrations/
│   └── supabase/             # Supabase client config
│
├── lib/
│   └── utils.ts              # Utility functions (cn, etc.)
│
├── types/                    # TypeScript type definitions
│
├── tests/                    # Frontend tests
│
├── App.tsx                   # Root component with router
├── main.tsx                  # Application entry point
└── index.css                 # Global styles (Tailwind)
```

## Routing

| Path | Component | Auth Required |
|------|-----------|--------------|
| `/` | `Index.tsx` (Dashboard) | Yes |
| `/home` | `PublicHome.tsx` | No |
| `/auth` | `Auth.tsx` | No |
| `/waitlist` | `Waitlist.tsx` | No |
| `/integrations` | `IntegrationsStatus.tsx` | Yes |
| `*` | `NotFound.tsx` | No |

## Data Flow

```
Backend API ──→ Custom Hooks (usePortfolio, etc.) ──→ Dashboard Panels
Backend WS  ──→ useBackendWebSocket ──→ Real-time updates
Supabase    ──→ AuthContext ──→ ProtectedRoute guard
```

## Design System

The frontend uses a **cyberpunk-inspired dark theme** with:
- Neon accent colors (cyan, magenta, green)
- Dark backgrounds (`bg-background`)
- Glass-panel card effects
- Monospace fonts for data display
- All themed via Tailwind CSS custom properties in `index.css`

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_BACKEND_URL` | Backend API base URL | `/api` (Vercel proxy) |
| `VITE_API_BASE_URL` | Alias for `VITE_BACKEND_URL` | `/api` |
| `VITE_SUPABASE_URL` | Supabase project URL | — |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | — |

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 8080)
npm run build        # Production build
npm run lint         # ESLint check
npm run preview      # Preview production build
```
