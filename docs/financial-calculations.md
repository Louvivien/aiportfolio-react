# Financial calculation review

The dashboard, exports, tag totals, charts and monthly reports now use lot-based calculations. All aggregate monetary values are in EUR. Individual position-table prices and P/L remain in the quote currency; chart amounts are in EUR.

## Valuation and currency

- Market value is the sum of quantities still held multiplied by current quotes, converted to EUR using the latest available dated ECB reference rate.
- Open and closed cost basis use the recorded purchase prices and purchase-date FX. Realized proceeds use each sale's price and sale-date FX. Their differences therefore include currency movements.
- An ECB USD rate means dollars per euro: USD amounts are **divided** by this rate. For example, USD 1,162.20 at 1.1622 becomes EUR 1,000. GBp/GBX quotes are converted from pence before applying GBP/EUR FX.
- Rates and historical prices use the latest observation on or before the requested date, with a maximum seven-day gap. Future observations are never used. Missing amounts/rates propagate as unavailable, not zero. Exports include the current FX date and rate.
- Purchase and sale prices are assumed to be recorded in the instrument's quote currency. The existing data model has no separate transaction currency or broker execution FX. ECB-based EUR results are estimates, not broker statement reconciliations.

Source: [ECB reference-rate explanation and daily USD rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html), [historical reference-rate XML](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml).

## Lot P/L and period percentages

- Every closed lot contributes realized P/L, including lots in positions that remain open. Aggregated position quantities do not replace the underlying lot ledger.
- Global P/L divided by total cost basis includes the cost of both open and closed lots. This is a ratio of trading gains to recorded purchase costs, which can count reinvested money more than once; it is not an account return.
- For each period, lots already held start at the preceding day's closing value. Purchases during the period start at their actual recorded execution cost. Sales during the period end at recorded execution proceeds. Lots bought after or sold before the period are excluded.
- Period percentages are the sum of lot P/L divided by opening value plus purchases during the period. The UI calls these **lot P/L / basis**, not investment returns. The 10D window is ten calendar days; the 1Y window uses the corresponding date one year earlier.
- Monthly “opening value + purchases” and “closing value + sales” are calculation bases, not cash-inclusive account balances. Reports retain individual lot contributions for audit, use calculation version 2 and regenerate outdated/stale cached reports. Editing position data marks reports stale.
- Missing purchase/sale dates are not inferred from record creation/edit times. An undated lot in a multi-lot position does not inherit the earliest purchase date or another lot's sale date. Missing eligible lot data suppresses the affected aggregate.
- Historical holdings charts reconstruct quantities held on each date, including lots since sold, carry forward recent closes across exchange holidays, and convert each date to EUR. Sales remove shares from holdings. Cash proceeds are not plotted. Rebased holdings charts are not return curves.

The app lacks a complete cash-flow, fee, dividend and corporate-action ledger, so it cannot establish an account's time-weighted return or money-weighted return/XIRR. Dividend-adjusted historical closes are no longer mixed with recorded transaction costs. Stock splits and other changes in share units must be reflected consistently in recorded lots and price history; no corporate-action reconciliation is performed.

## Fundamentals

Automatic P/E needs positive latest EPS, matching quote/EPS currencies, an exact symbol match and a verified listed-share basis. The current annual fundamentals feed does not certify depositary-share ratios, so unverified automatic P/E and dependent PEG are unavailable. Explicit manual overrides remain. Old stored automatic ratios and older positive EPS are not used as fallbacks. EPS CAGR now uses elapsed years instead of the number of reported observations.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build:frontend` from the project root. Regression fixtures cover mixed EUR/USD valuations, pence, historical FX, partial closures, a synthetic EUR 204.70 loss case, staggered June purchases, period boundaries, stale/missing observations, report aggregation, historical holdings and EPS basis checks. They are not a reconciliation of the user's broker holdings.
