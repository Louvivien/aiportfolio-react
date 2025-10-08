# AI Portfolio Tracker (Monorepo)

This workspace now contains both the React front-end and a Node.js/Express backend so you can run the entire AI portfolio tracker without any Python services.

## Project layout

```
aiportfolio-react/
├── backend/          # Node.js API (Express, MongoDB, Yahoo Finance integration)
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── app.js
│       ├── server.js
│       ├── db.js
│       ├── config.js
│       ├── priceService.js
│       └── routes/
└── frontend/         # React dashboard (Vite + TypeScript)
    ├── package.json
    ├── src/
    └── vite.config.ts
```

## Prerequisites

- Node.js 18+ (for both back-end and front-end)
- MongoDB instance (Atlas or self-hosted) reachable via connection string

## 1. Install dependencies

From the repo root:

```bash
npm install   # installs both backend/ and frontend/ workspaces
```

## 2. Configure & run the backend

```bash
cd backend
cp .env.example .env        # then update MONGODB_URI (and PORT if desired)
npm run dev                 # launches Express on http://127.0.0.1:4000
```

The API exposes the same contract as the original FastAPI service:

- `GET /api/tags`
- `GET /api/positions`
- `POST /api/positions`
- `PUT /api/positions/:id`
- `DELETE /api/positions/:id`
- `GET /api/positions/summary`
- `GET /api/positions/summary/debug`
- `GET /api/positions/tags/summary`
- `GET /api/positions/tags/timeseries?period=6mo&interval=1d`

It connects to MongoDB collections `positions` and `tags`, enriches rows with live data from Yahoo Finance, and mirrors the calculations from the previous FastAPI implementation (intraday changes, 10-day deltas, tag aggregation, and time-series roll-ups).

## 3. Start the React dashboard

```bash
cd frontend
npm run dev                # serves http://localhost:5173
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:4000`, so the backend must be running to see portfolio data. The React app is unchanged feature-wise: sortable positions grid, tag summary, performance chart modal, totals panel, and modal editing experience.

## Production build

```bash
# Backend
cd backend
npm run start              # runs server without nodemon

# Frontend
cd frontend
npm run build
npm run preview            # optional local preview of the bundle
```

## Deploying to Vercel

Create two Vercel projects—one for the React bundle, one for the API.

### Frontend project (Vite)

1. In Vercel choose **Add New… → Project**, select this repo, and set **Root Directory** to `frontend`.
2. The included `frontend/vercel.json` preconfigures `npm install`, `npm run build`, and `dist` as the output—accept the suggested values.
3. Under **Environment Variables** add `VITE_API_BASE=https://YOUR-BACKEND-URL.vercel.app/api` (replace once the backend is live).
4. Deploy; the `.npmrc` inside `frontend/` keeps rollup on the portable build that works in Vercel.

### Backend project (Express on serverless functions)

1. Create another Vercel project from the same repo but set **Root Directory** to `backend`.
2. Skip the build command (leave it blank). Vercel deploys the handlers in `backend/api/[...path].mjs` automatically after `npm install`.
3. Add the MongoDB Atlas integration (or set env vars manually). At minimum provide `MONGODB_URI`; Atlas also supplies `MONGODB_DATABASE`.
4. If the frontend uses the deployed backend, remember to copy the production URL into the frontend project’s `VITE_API_BASE`.
5. For local parity run `cp backend/.env.example backend/.env` and reuse the same connection string.

> **Note:** The repo ships with `.npmrc` files setting `rollup_skip_nodejs_native_build=true` (root and `frontend/`), and the frontend build script reinforces `ROLLUP_SKIP_NODEJS_NATIVE_BUILD=1`, so rollup always falls back to its portable build. Keep these in place for Vercel.

### Local parity after the changes

- Backend: `npm run dev:backend` (or `npm run start --workspace backend`) runs the Express server on port 4000.
- Frontend: `npm run dev:frontend` proxies `/api` to `http://127.0.0.1:4000`.
- If you want the frontend to talk to a different API host, set `VITE_API_BASE` (e.g. `VITE_API_BASE=https://your-app.vercel.app/api`) before building.

## Testing

- Backend: add your preferred testing framework (e.g. Jest) and hit the Express handlers directly—no tests are shipped yet.
- Frontend: set up React Testing Library or Cypress in `frontend/` (the React code is TypeScript-ready and already linted).

## Notes

- Update `frontend/vite.config.ts` if you expose the API on a different host/port.
- The backend relies on Yahoo Finance public endpoints via the [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) package. Heavy usage may require caching or rate-limit handling.
- Environment-specific secrets belong in `backend/.env` (ignored from version control) or Vercel project settings. The frontend remains a pure static bundle.
