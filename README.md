# AfriCreator IQ V13.2 Verified Project

This package contains the V13 frontend, backend, and Supabase database schema for AfriCreator IQ.

## Fixes and verification in V13.2

- Connected the Campaign Brief Generator frontend to the existing backend API.
- Added required campaign-goal validation and visible success/error feedback.
- Added strict HTTPS TikTok profile URL validation and canonical URL normalization.
- Added duplicate-watchlist prevention with database indexing and backend upsert behavior.
- Added safe input whitelisting for campaign and trend creation routes.
- Improved `/api/health` so it reports both database configuration and real database connectivity.
- Added configurable production CORS through `ALLOWED_ORIGINS`.
- Added JSON responses for malformed requests, blocked origins, unknown routes, and server errors.
- Improved AI Match ordering so the highest-scoring creators appear first.
- Improved the dashboard backend status indicator.
- Added database indexes for common creator, history, log, campaign, and trend queries.
- Preserved the earlier sync safeguards so automated sync does not overwrite admin metadata.

## Deploy order

1. Supabase
2. Render backend
3. Vercel frontend

## Supabase

Run this file in the Supabase SQL editor:

```txt
database/v13_schema.sql
```

The SQL is safe for a fresh database and also normalizes/removes duplicate watchlist rows before applying the unique watchlist index.


## npm registry deployment fix

This release uses the public npm registry in both frontend and backend lockfiles. If a previous Render deployment cached a failed npm install, select **Clear build cache and deploy** before rebuilding.

## Render backend

- Root Directory: `backend`
- Build Command: `npm ci --no-audit --no-fund`
- Start Command: `npm start`
- Required Environment Variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ALLOWED_ORIGINS` — comma-separated frontend origins, for example `https://your-app.vercel.app`

Optional:

- `PORT` — Render normally supplies this automatically.

Test after deployment:

```txt
https://your-render-backend-url.onrender.com/api/health
```

A healthy response should report:

```json
{
  "status": "healthy",
  "databaseConfigured": true,
  "databaseConnected": true
}
```

## Vercel frontend

- Root Directory: `frontend`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Required Environment Variables:
  - `VITE_API_URL`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

`VITE_API_URL` must be the Render backend URL, without a trailing slash.

## Local testing

Backend:

```bash
cd backend
npm ci --no-audit --no-fund
npm start
```

Frontend:

```bash
cd frontend
npm ci --no-audit --no-fund
npm run build
npm run dev
```

## Important production limitations

- Demo email login is only a frontend convenience and is not secure authentication.
- Backend write routes still need proper authenticated authorization before public production use.
- Subscription limits and permissions are not yet enforced by the backend.
- TikTok public-page extraction can return partial/fallback data when TikTok blocks or changes its page structure.
- AI Match, Trend Prediction, and Niche Recommendation are currently basic scoring/rule-based MVP features, not full AI models.
- Render free instances may sleep, which can interrupt the in-process 10-minute cron schedule.
