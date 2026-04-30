# Deployment Without CircleCI

CircleCI is optional for this project. The frontend can still deploy on Vercel, and the backend can run on a Python web host, even when CircleCI is unavailable.

## Local validation

Run this before release:

```bash
make release-check
```

The command runs the local release validation script and reports failing steps clearly.

## Frontend

Keep using Vercel for the frontend. Set the frontend backend URL in the Vercel project settings so the browser points to the deployed backend instead of localhost.

The startup recovery screen added to the app will show a setup message if production configuration is incomplete.

## GitHub branch settings

If a repository rule requires CircleCI, edit the branch rule for `main` and remove the CircleCI check from the required list. Keep Vercel and any working release-check workflow as the active validation signals.

## Backend

Use a Python web service host. The included `render.yaml` is a minimal template for a Render web service.

For free-tier/demo operation, run paper mode only. Free web services may sleep when idle and may not preserve local files between restarts.
