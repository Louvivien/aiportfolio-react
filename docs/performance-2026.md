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

Account cash is never inferred from trades or replaced with zero. Evidence fields
`opening_cash_eur`, `current_cash_eur` and `current_cash_date` must be supplied.
`scope_complete`, `flow_history_complete` and `transfers_reviewed` must be confirmed.
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
and the existing lot-based exports, retain their separate meaning. The new card
provides its own export with methodology, dated flows and completeness reasons.
