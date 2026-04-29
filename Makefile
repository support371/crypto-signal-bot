PYTHON  ?= python3
PIP     ?= pip
NPM     ?= npm
VENV_DIR ?= .venv
VENV_BIN := $(VENV_DIR)/bin
VENV_PYTHON := $(VENV_BIN)/python
VENV_PIP := $(VENV_BIN)/pip

.PHONY: help install backend-install frontend-install \
        backend frontend build \
        test test-v test-live lint repo-audit branch-salvage \
        docker-build-backend docker-build-frontend docker-build-stack \
        compose-preflight compose-up compose-down compose-backend compose-backend-down \
        synthetic-paper-smoke testnet-smoke testnet-smoke-dry live-paper-smoke secured-write-smoke compose-live-paper-smoke release-verify clean

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
	@echo "    make repo-audit           Run structural repo audit checks"
	@echo "    make branch-salvage       Inventory remote branches for salvage candidates"
	@echo ""
	@echo "  Build:"
	@echo "    make build                Build frontend for production"
	@echo "    make docker-build-stack   Prebuild backend + frontend container images"
	@echo ""
	@echo "  Docker:"
	@echo "    make compose-preflight    Check for Docker Compose v2"
	@echo "    make compose-up           Start full stack with docker compose"
	@echo "    make compose-down         Stop full stack"
	@echo "    make compose-backend      Start backend only"
	@echo "    make compose-backend-down Stop backend only"
	@echo ""
	@echo "  Live mode:"
	@echo "    make synthetic-paper-smoke Validate synthetic paper mode against a running backend"
	@echo "    make testnet-smoke        Run live/testnet smoke test (uses EXCHANGE, requires matching creds)"
	@echo "    make testnet-smoke-dry    Run live/testnet smoke test without placing an order"
	@echo "    make live-paper-smoke     Validate hybrid live-paper mode against a running backend"
	@echo "    make secured-write-smoke  Validate write-endpoint auth flow against a running backend"
	@echo "    make compose-live-paper-smoke  Start full stack and validate nginx /api + /ws live-paper flow"
	@echo "    make release-verify       Run the canonical stabilization/release verification path"
	@echo ""
	@echo "  Cleanup:"
	@echo "    make clean                Remove build artifacts and caches"
	@echo ""

install: backend-install frontend-install

backend-install:
	$(PYTHON) -m venv $(VENV_DIR)
	$(VENV_PIP) install -r backend/requirements.txt

frontend-install:
	$(NPM) install

backend:
	$(VENV_PYTHON) -m uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000

frontend:
	$(NPM) run dev -- --host 0.0.0.0 --port 8080

test:
	$(VENV_PYTHON) -m pytest backend/tests -q

test-v:
	$(VENV_PYTHON) -m pytest backend/tests -v --tb=short

test-live:
	$(VENV_PYTHON) -m pytest backend/tests/test_live_mode.py -v --tb=short

lint:
	@$(VENV_PYTHON) -c "import ruff" >/dev/null 2>&1 && $(VENV_PYTHON) -m ruff check backend/ || echo "ruff not installed in $(VENV_DIR) — run: $(VENV_PIP) install ruff"

repo-audit:
	$(VENV_PYTHON) scripts/repo_audit.py

branch-salvage:
	$(VENV_PYTHON) scripts/branch_salvage_inventory.py --remote $${REMOTE:-origin}

build:
	$(VENV_PYTHON) scripts/frontend_build.py

docker-build-backend:
	$(VENV_PYTHON) scripts/docker_build_stack.py --target backend

docker-build-frontend:
	$(VENV_PYTHON) scripts/docker_build_stack.py --target frontend

docker-build-stack:
	$(VENV_PYTHON) scripts/docker_build_stack.py

compose-preflight:
	$(VENV_PYTHON) scripts/compose_preflight.py

compose-up: compose-preflight docker-build-stack
	docker compose -f docker-compose.fullstack.yml up --no-build -d

compose-down: compose-preflight
	docker compose -f docker-compose.fullstack.yml down

compose-backend: compose-preflight docker-build-backend
	docker compose -f docker-compose.yml up --no-build -d

compose-backend-down: compose-preflight
	docker compose -f docker-compose.yml down

synthetic-paper-smoke:
	$(VENV_PYTHON) scripts/synthetic_paper_smoke.py

testnet-smoke:
	$(VENV_PYTHON) scripts/testnet_smoke.py --exchange $${EXCHANGE:-binance}

testnet-smoke-dry:
	$(VENV_PYTHON) scripts/testnet_smoke.py --exchange $${EXCHANGE:-binance} --dry-run

live-paper-smoke:
	$(VENV_PYTHON) scripts/live_paper_smoke.py --exchange $${MARKET_DATA_PUBLIC_EXCHANGE:-$${EXCHANGE:-binance}}

secured-write-smoke:
	$(VENV_PYTHON) scripts/secured_write_smoke.py --api-key $${BACKEND_API_KEY:?set BACKEND_API_KEY first}

compose-live-paper-smoke:
	$(VENV_PYTHON) scripts/compose_live_paper_smoke.py --exchange $${MARKET_DATA_PUBLIC_EXCHANGE:-$${EXCHANGE:-binance}}

release-verify:
	$(VENV_PYTHON) scripts/release_verify.py

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache dist node_modules/.cache
	@echo "Clean complete"
