PYTHON ?= python
PIP ?= pip
NPM ?= npm

.PHONY: backend-install frontend-install backend frontend build test compose-up compose-down

backend-install:
	$(PIP) install -r backend/requirements.txt

frontend-install:
	$(NPM) install

backend:
	cd backend && uvicorn app:app --reload --host 0.0.0.0 --port 8000

frontend:
	$(NPM) run dev -- --host 0.0.0.0 --port 8080

build:
	VITE_BACKEND_URL=/api VITE_API_BASE_URL=/api $(NPM) run build

test:
	pytest backend/tests -q

compose-up:
	docker compose -f docker-compose.fullstack.yml --env-file .env up --build

compose-down:
	docker compose -f docker-compose.fullstack.yml down
