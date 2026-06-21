# Crypto Signal Bot V2 - Frontend

A React/TypeScript frontend application for the Crypto Signal Bot V2 trading system with paper trading mode.

## Features

- **Paper Trading Mode**: All API calls return mock data, no real funds at risk
- **Operator Boundary**: Live trading, withdrawals, and privileged operations are blocked
- **Real-time Signals**: WebSocket integration for live signal updates
- **Portfolio Management**: Track your paper trading portfolio performance
- **Advanced Analytics**: Historical performance, backtesting, and signal analysis
- **Multi-Exchange**: Support for Binance, Coinbase, Kraken, and more

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query + Zustand
- **Database**: Supabase (with mock implementation for paper trading)
- **Testing**: Vitest

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

## Project Structure

```
crypto-signal-v2/
├── src/
│   ├── components/       # Reusable UI components
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Utility functions and types
│   ├── pages/           # Page components
│   ├── providers/       # React context providers
│   ├── test/            # Test files
│   ├── App.tsx          # Main app component
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.js
```

## Safety Features

1. **Paper Trading Enforcement**: All trading operations use mock data
2. **Operator Boundary Checks**: Blocks live trading at the API level
3. **Withdrawal Disabled**: Withdrawal functionality is completely disabled
4. **No Real API Keys**: Only mock exchange connections are allowed

## Configuration

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-key
VITE_PAPER_TRADING_MODE=true
```

## License

Private - GEM Cybersecurity & Monitoring Assist