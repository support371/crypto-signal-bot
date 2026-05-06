# Backend Hosting Guide

## Purpose

This repository can run without CircleCI. Use Vercel for the frontend and a Python web service host for the backend.

## Render template

A minimal `render.yaml` is included for a Python web service.

Manual settings:

```text
Build command: pip install -r backend/requirements.txt
Start command: uvicorn backend.app:app --host 0.0.0.0 --port $PORT
Health path: /health
```

## Frontend connection

After the backend service is created, copy its HTTPS URL and set it in the Vercel frontend project as the backend URL value. Redeploy the frontend after changing project settings.

## Free service limits

Free web services can sleep when idle. Local files may not survive restarts or redeploys. Use this path for demo and validation environments.

## Other options

- A Python web host with persistent storage.
- A local backend exposed through a secure tunnel.
- A container host with HTTPS and durable volumes.
