#!/bin/bash
# ============================================================
# crypto-signal-bot — Full Migration Push Script
# Run this ONCE from inside a fresh clone of the repo.
# Pushes all Phase 1–15 + MT5 files in one commit.
# ============================================================

set -e

REPO_DIR="$(pwd)"
BRANCH="backend-first-migration"
COMMIT_MSG="feat: backend-first migration phases 1-15 + MT5 integration

- Phase 4:  Config authority (settings.py, loader.py)
- Phase 5:  Exchange adapters (Binance, BTCC, Bitget)
- Phase 6:  Live market data service, no synthetic prices
- Phase 7:  Prediction service extraction
- Phase 8:  Guardian service (sovereign, non-cosmetic)
- Phase 9:  Execution engine (coordinator, routing, P&L)
- Phase 10: Kill switch + append-only audit log
- Phase 11: Authoritative DB persistence (9 tables, Alembic)
- Phase 12: Auth middleware + rate limiting
- Phase 13: Frontend rewired to backend truth only
- Phase 14: Deployment topology + runbooks
- Phase 15: E2E validation suite
- MT5:      Full broker adapter, bridge service, venue registry"

echo ""
echo "=== crypto-signal-bot: Full Migration Push ==="
echo ""

# Confirm we're inside the repo
if [ ! -f "package.json" ]; then
  echo "ERROR: Run this script from inside the crypto-signal-bot repo directory."
  exit 1
fi

# Create and switch to migration branch
echo "1. Creating branch: $BRANCH"
git checkout -b "$BRANCH" 2>/dev/null || git checkout "$BRANCH"

echo "2. Staging all migration files..."
git add -A

echo "3. Committing..."
git commit -m "$COMMIT_MSG"

echo "4. Pushing to origin..."
git push origin "$BRANCH"

echo ""
echo "=== DONE ==="
echo ""
echo "Next steps:"
echo "  a) Open a PR on GitHub: support371/crypto-signal-bot"
echo "     from branch: $BRANCH → main"
echo "  b) Merge to main → Vercel auto-deploys the frontend"
echo "  c) Deploy backend files to your server separately"
echo "  d) Set VITE_BACKEND_URL in Vercel env vars"
echo ""
