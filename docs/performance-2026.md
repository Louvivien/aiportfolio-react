# Consolidated Performance 2026

`GET /api/performance/2026` reconstructs securities from the stored purchase and
sale lots, including positions sold since the opening date. It reads user-provided
external-flow evidence from `performance_inputs` (document ID
`personal-management-2026-identified-flows-v1`). The display is consolidated,
without a per-account breakdown. Position tags are not account identifiers.

The 31 December 2025 closing valuation is the opening capital at 1 January 2026.
Amounts are converted to EUR at their respective valuation dates. The official
[Xetra 2025 calendar](https://www.xetra.com/resource/blob/4064968/4079a2d5a9fec324905942b807b398ed/data/xetra-trading-calendar-2025.pdf)
confirms that 31 December was closed: `.DE` securities use the 30 December close.
This exception does not apply to fund NAVs or arbitrary missing weekdays.
Previously retrieved opening quotes can be stored in `opening_quotes`, with the
symbol, valuation date, actual quote date, price, currency and retrieval provenance.
These are used only for their exact historical boundary; quantities are always
reconstructed from the latest lots. They never replace a current quote. This
keeps a temporary provider outage from discarding known opening data.

Account cash is never inferred from trades or replaced with zero. Evidence fields
`opening_cash_eur`, `current_cash_eur` and `current_cash_date` must be supplied.
`scope_complete`, `flow_history_complete` and `transfers_reviewed` must be confirmed
for a definitive result.
The opening and current securities valuations must also be complete. Existing
position records alone cannot establish full account coverage or cash balances.

`dated_movements` are the only source of XIRR flows. Reconciliation summaries are
not added to them. Every movement has a stable ID, a positive integer amount in
cents, an ISO date, EUR currency, an external-scope classification, and a confirmed
effective date. Transfer initiation dates remain provisional. Duplicate IDs,
unknown dates/currencies and unreconciled movements prevent a definitive return.
Explicitly internal transfers, buys, sales, dividends, interest and fees are not
external contributions. Dividends, interest and fees are reflected through actual
balances and must not be added to those balances again. Promotional credits are
separate capital contributions; they do not inflate investment gains.

With investor-perspective signs, initial capital, personal deposits and promotional
credits are negative; external withdrawals and the final value are positive.
XIRR uses actual elapsed days / 365. The displayed percentage is
`100 * ((1 + annualized_xirr) ** (days_since_2026_01_01 / 365) - 1)`.
The EUR gain is separately `final - initial - deposits + withdrawals - promotions`.
The annualized rate remains available in the dedicated JSON export, not as the
headline. No target percentage enters the calculation.

The solver groups same-day flows and solves in log(1 + rate). It conservatively
requires cumulative investor cash flow to remain negative before the terminal
payment, ensuring a unique root; other patterns are flagged for review rather than
selecting an arbitrary root. Missing financial inputs suppress both headline
figures. A numerical TRI failure can still retain the independently verified EUR
gain. After year-end, live quotes cannot stand in for the 2026 closing valuation.

This replaces the global rolling-1Y badge. Per-security and tag 1Y P/L analysis,
and the existing lot-based exports, retain their separate meaning. The API retains methodology, dated flows and completeness reasons for audit.


When all numerical inputs are available but coverage, transfer review or credit
dates remain provisional, the API also provides an explicit `indicative` result.
The same XIRR and EUR-gain formulas use the recorded flows and known dates, without
changing evidence confirmations. Definitive top-level metrics remain null.
The interface keeps the original dashboard layout. Its third totals badge, formerly
“1Y P/L”, now shows “Performance 2026” with the EUR gain and effective percentage.
There is no additional panel, status label or explanatory text in the dashboard.
Assumptions and confirmation status remain in the API response.
Missing prices/cash, stale cash dates, invalid amounts/dates, duplicate movements
and unknown external-flow classification block indicative results too. In that
case the badge displays a dash; the API retains the reason. The UI never
uses “Incomplet” as the metric value. Exports retain all audit information.

## Documented accounting corrections

`GET /api/performance/2026/reconciliation` exposes the stored accounting evidence:
dated broker entries, net cash amounts in integer cents, fees/taxes, source hashes,
links to existing external-flow IDs, verified account lots and unresolved items.
This journal is documentary evidence, not an additional set of holdings or flows.
Trade prices in fully reconciled purchase lots include actual debited fees and
rounding; sale prices reflect actual net proceeds. The journal retains gross
execution prices separately, so fees must not be deducted again from lot values.

For an aggregate whose other purchases or account allocations are unknown, keep
the original quantity and cost rather than derive a residual cost from its average.
Link confirmed component trades to the existing position and record the remaining
uncertainty. A position with `reconciliation.opening_inventory_status: 'unverified'`
is excluded from the known opening subtotal and makes opening valuation incomplete.
An unchanged legacy purchase date is not evidence of ownership at year-end.

`accounting_reconciliation.unresolved` entries with `blocks_return: true` suppress
indicative results too. This covers documented omissions and contradictory inputs,
not just a general lack of confirmation. Superseded cash declarations are retained
in the reconciliation history; missing consolidated cash is null, never zero.
Individual cash observations are not summed across incompatible valuation dates.
No dashboard layout change is required; the existing badge uses its neutral dash.

## Performance-only scope and confirmed opening inventory

`performance_scope.excluded_symbols` filters only this calculation. NVIDIA uses
its complete stored quantity at each boundary, including the Alpaca fraction;
SOXL is excluded. `excluded_flow_accounts` excludes Alpaca funding. Consolidated
cash is the user-declared amount for the five other accounts; no Alpaca cash is
inferred. These rules do not alter main-portfolio lots or other indicators.

`opening_inventory` can record a dated, documented or user-confirmed quantity
for a position ID and symbol. It replaces only its 31 December opening quantity,
never its price, current quantity or purchase cost. This allows the confirmed
Parrot and H2O inventories to override the former unreconciled aggregates without
inventing residual purchase prices. Duplicate/invalid entries and missing target
positions make opening valuation incomplete. Stored opening quotes and historical
FX still determine value; no EUR contribution or performance is hardcoded.

An `opening_cash_status` of `estimated` always keeps the result indicative, even
if all other confirmations are complete. Historical transaction gaps can remain
nonblocking documentary issues when endpoint holdings, declared cash and external
flows provide the calculation inputs. Prior issue assessments are retained in
the evidence history rather than silently erased.

The existing badge reloads on position changes, every minute and on window focus,
so changes to evidence also refresh it. It ignores responses from superseded
requests. The backend always reads the latest inputs; the market-price cache has
a one-minute TTL. The exact cash observation date remains part of validation.
