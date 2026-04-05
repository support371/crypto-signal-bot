PYTHON  ?= python
PIP     ?= pip
NPM     ?= npm

.PHONY: help install backend-install frontend-install \
        backend frontend build \
        test test-v test-live lint \
        compose-up compose-down compose-backend compose-backend-down \
        testnet-smoke clean

# ── Default ───────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Crypto Signal Bot — available targets"
	@echo ""
	@echo "  Setup:"
	@echo "    make install              Install all backend + frontend deps"
	@echo "    make backend-install      Install backend Python deps only"
	@echo "    make frontend-install     Install frontend npm deps only"
	@echo ""
	@echo "  Development:"
	@echo "    make backend              Start backend dev server (port 8000)"
	@echo "    make frontend             Start frontend dev server (port 8080)"
	@echo ""
	@echo "  Testing:"
	@echo "    make test                 Run all backend tests (quiet)"
	@echo "    make test-v               Run all backend tests (verbose)"
	@echo "    make test-live            Run live-mode routing tests only"
	@echo "    make lint                 Run ruff linter on backend"
	@echo ""
	@echo "  Build:"
	@echo "    make build                Build frontend for production"
	@echo ""
	@echo "  Docker:"
	@echo "    make compose-up           Start full stack (backend + frontend)"
	@echo "    make compose-down         Stop full stack"
	@echo "    make compose-backend      Start backend only"
	@echo "    make compose-backend-down Stop backend only"
	@echo ""
	@echo "  Live mode:"
	@echo "    make testnet-smoke        Run testnet smoke test (requires BINANCE_* creds)"
	@echo "    make testnet-smoke-dry    Run testnet smoke test without placing an order"
	@echo ""
	@echo "  Cleanup:"
	@echo "    make clean                Remove build artifacts and caches"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
install: backend-install frontend-install

backend-install:
	$(PIP) install -r backend/requirements.txt

frontend-install:
	$(NPM) install

# ── Development ───────────────────────────────────────────────────────────────
backend:
	uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000

frontend:
	$(NPM) run dev -- --host 0.0.0.0 --port 8080

# ── Testing ───────────────────────────────────────────────────────────────────
test:
	$(PYTHON) -m pytest backend/tests -q

test-v:
	$(PYTHON) -m pytest backend/tests -v --tb=short

test-live:
	$(PYTHON) -m pytest backend/tests/test_live_mode.py -v --tb=short

lint:
	@command -v ruff >/dev/null 2>&1 && ruff check backend/ || echo "ruff not installed — run: pip install ruff"

# ── Build ─────────────────────────────────────────────────────────────────────
build:
	VITE_BACKEND_URL=/api VITE_API_BASE_URL=/api $(NPM) run build

# ── Docker ────────────────────────────────────────────────────────────────────
compose-up:
	docker compose -f docker-compose.fullstack.yml up --build

compose-down:
	docker compose -f docker-compose.fullstack.yml down

compose-backend:
	docker compose -f docker-compose.yml up --build

compose-backend-down:
	docker compose -f docker-compose.yml down

# ── Live mode ─────────────────────────────────────────────────────────────────
testnet-smoke:
	$(PYTHON) scripts/testnet_smoke.py

testnet-smoke-dry:
	$(PYTHON) scripts/testnet_smoke.py --dry-run

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache dist node_modules/.cache
	@echo "Clean complete"
