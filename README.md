# AI Portfolio Tracker (Monorepo)

This workspace now contains both the React front-end and a Node.js/Express backend so you can run the entire AI portfolio tracker without any Python services.

## Project layout

```
aiportfolio-react/
├── backend/          # Node.js API (Express, MongoDB, Yahoo Finance integration)
│   ├── package.json
│   ├── .env.example
│   └── src/
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

## Testing

- Backend: add your preferred testing framework (e.g. Jest) and hit the Express handlers directly—no tests are shipped yet.
- Frontend: set up React Testing Library or Cypress in `frontend/` (the React code is TypeScript-ready and already linted).

## Notes

- Update `frontend/vite.config.ts` if you expose the API on a different host/port.
- The backend relies on Yahoo Finance public endpoints via the [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) package. Heavy usage may require caching or rate-limit handling.
- Environment-specific secrets belong in `backend/.env` (ignored from version control). The frontend remains a pure static bundle.
