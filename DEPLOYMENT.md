# Deployment Guide

This repository now includes a full-stack container deployment path for the React frontend and FastAPI backend.

## Included deployment assets

- `Dockerfile` — backend image
- `Dockerfile.frontend` — frontend build + Nginx image
- `deploy/nginx.conf` — frontend static hosting and backend reverse proxy
- `docker-compose.fullstack.yml` — full-stack local deployment
- `.env.fullstack.example` — deployment environment example

## Quick start

1. Copy the deployment env template if you want to customize values:

```bash
cp .env.fullstack.example .env
```

2. Start the full stack:

```bash
docker compose -f docker-compose.fullstack.yml --env-file .env up --build
```

If you do not create `.env`, Docker Compose defaults in `docker-compose.fullstack.yml` are sufficient for local paper-mode startup.

## Access points

- Frontend: `http://localhost:8080`
- Backend (internal behind frontend proxy): `http://localhost:8080/api`

## Deployment model

- Frontend is built with Vite and served by Nginx
- Nginx proxies `/api/*` requests to the FastAPI backend container
- Nginx proxies `/ws/*` to the backend websocket path
- Backend remains in `paper` mode by default

## Notes

- This deployment path is intended for local and staging-style launches
- Live trading should remain disabled until exchange adapters, auth hardening, and validation are complete
- The existing `docker-compose.yml` is backend-only; use `docker-compose.fullstack.yml` for the app launch path
