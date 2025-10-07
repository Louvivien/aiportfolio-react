# AI Portfolio Dashboard (Frontend)

This folder contains the Vite + React interface for the AI portfolio tracker. It consumes the Express API located in `../backend` and preserves the feature-set from the original Streamlit application.

## Features

- Sortable positions grid with conditional colouring, Yahoo Finance links, and tag chips.
- Tag summary table that doubles as a filter surface and opens the performance chart modal.
- Modal dialogs for adding and editing positions, including closing-price capture for closed holdings.
- Timeseries comparison view (Recharts) with tag selection, normalisation toggle, and metric switching.
- Totals banner mirroring invested capital, open market value, intraday moves, and 10-day deltas.

## Getting Started

```bash
cd frontend
npm install
npm run dev
```

- Develop at `http://localhost:5173`.
- API calls hit `/api/...` and are proxied to `http://127.0.0.1:4000` (adjust via `vite.config.ts` if you change the backend port).

### Additional scripts

```bash
npm run build     # generate production bundle in dist/
npm run preview   # preview the build locally
npm run lint      # lint the TypeScript sources (via ESLint)
```

## Structure

```
frontend/
├── public/            # Static assets
├── src/
│   ├── api/           # Axios client + type definitions
│   ├── components/    # UI building blocks (forms, tables, modals, charts)
│   ├── utils/         # Formatting helpers, portfolio calculations, colour scales
│   ├── App.tsx        # Application state orchestration
│   └── main.tsx       # React entry point
├── tsconfig*.json     # TypeScript compiler options
└── vite.config.ts     # Vite configuration + dev proxy
```

## Notes

- The UI defaults to EUR when no currency is supplied by the backend. Adjust `src/utils/format.ts` to change that behaviour.
- When running the Express backend in production mode, point the frontend build output (`dist/`) to your static hosting solution of choice (or serve it behind the same Express app).
