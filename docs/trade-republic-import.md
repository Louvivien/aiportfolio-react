# Trade Republic trade signs

`backend/src/tradeRepublicImport.js` normalizes EUR BUY/SELL rows before any
net unit price is calculated. The local accounting reconciliation importer
`aiportfolio-reports/apply-proven-corrections-2026.mjs` uses this helper.

- `source_quantity` retains the CSV share movement, including a negative SELL quantity.
- `quantity` is the strictly positive execution quantity.
- `signed_quantity` records the share movement implied by BUY/SELL.
- Cash retains its direction: purchase debits are negative, sale credits positive;
  fees and taxes are negative. Cash calculations use integer cents.
- The gross execution price remains distinct from the net unit price used by
  the lot accounting. Negative execution prices or inconsistent cash signs are
  rejected, rather than silently taking their absolute value.

For a sale of one share at EUR 890 with EUR 1 in fees, the CSV can contain
`shares = -1`. Net proceeds are EUR 889, and the lot's `closing_price` must be
`889 / 1 = 889`, never `889 / -1`. Since the closing price is already net, the
fee must not be deducted again from the realized P/L.

Position creation and updates also reject negative closing prices, including
prices nested in purchase lots. Existing historical data requires an explicit,
backed-up repair; valuation code does not silently change signs.

The October 2026 Micron repair preserves the fee-inclusive acquisition cost and
all external flows and cash balances. It changes historical realized P/L only.
Performance 2026 is independently calculated from opening/final portfolio
values and dated external flows; it does not add historical realized P/L.

Regression coverage: `backend/test/tradeRepublicImport.test.js` verifies signed
share movements, fees, taxes, invalid signs, position validation, and unchanged
holdings and Performance 2026 after the sale-price repair.
