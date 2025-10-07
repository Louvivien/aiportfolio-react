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

## 1. Configure & run the backend

```bash
cd backend
cp .env.example .env        # then update MONGODB_URI (and PORT if desired)
npm install
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

## 2. Start the React dashboard

```bash
cd frontend
npm install
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

This repo now includes an `api/[...path].mjs` catch-all function that wraps the Express app for Vercel serverless. Deployment steps:

1. Push the repo to Git and run `vercel` from the project root (or connect the GitHub repo in the Vercel dashboard).
2. Set build settings:
   - **Framework**: `Other`.
   - **Build Command**: `npm run build` inside `frontend/`.
   - **Output Directory**: `frontend/dist`.
   - **Install Command**: `npm install --prefix frontend`.
3. Under **Environment Variables**, add `MONGODB_URI` (and any others you need). No `PORT` is required.
4. Vercel will serve the static frontend and proxy `/api/*` requests to the serverless Express handler.

### Local parity after the changes

- Backend: `npm run dev` (or `npm run start`) continues to run a long-lived Express server on port 4000.
- Frontend: `npm run dev` still proxies `/api` to `http://127.0.0.1:4000`.
- If you want the frontend to talk to a different API host, set `VITE_API_BASE` (e.g. `VITE_API_BASE=https://your-app.vercel.app/api`) before building.

## Testing

- Backend: add your preferred testing framework (e.g. Jest) and hit the Express handlers directly—no tests are shipped yet.
- Frontend: set up React Testing Library or Cypress in `frontend/` (the React code is TypeScript-ready and already linted).

## Notes

- Update `frontend/vite.config.ts` if you expose the API on a different host/port.
- The backend relies on Yahoo Finance public endpoints via the [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) package. Heavy usage may require caching or rate-limit handling.
- Environment-specific secrets belong in `backend/.env` (ignored from version control) or Vercel project settings. The frontend remains a pure static bundle.
