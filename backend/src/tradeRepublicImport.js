// A broker's signed share movement is not an execution quantity or unit price.
// Preserve source signs for audit; normalize quantities before deriving net prices.
const numeric = (value, field, optional = false) => {
  if (value === '' || value === null || value === undefined) {
    if (optional) return 0;
    throw new Error(`Missing Trade Republic ${field}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Trade Republic ${field}.`);
  return parsed;
};
const cents = (value, field, optional = false) => {
  const scaled = numeric(value, field, optional) * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-6)
    throw new Error(`Trade Republic ${field} is not an exact cent amount.`);
  return rounded;
};

export function netTradeUnitPrice(trade) {
  if (!['buy', 'sell'].includes(trade.direction) || !Number.isFinite(trade.quantity) || trade.quantity <= 0
    || !Number.isSafeInteger(trade.net_cash_cents)) throw new Error('Invalid normalized trade.');
  const proceeds = trade.direction === 'buy' ? -trade.net_cash_cents : trade.net_cash_cents;
  if (proceeds < 0) throw new Error('Trade cash sign conflicts with its direction.');
  return proceeds / 100 / trade.quantity;
}

export function normalizeTradeRepublicTrade(row) {
  if (!['BUY', 'SELL'].includes(row.type) || row.currency !== 'EUR')
    throw new Error('Expected an EUR Trade Republic BUY or SELL.');
  const direction = row.type === 'BUY' ? 'buy' : 'sell';
  const sourceQuantity = numeric(row.shares, 'shares');
  const quantity = Math.abs(sourceQuantity);
  const executionPrice = numeric(row.price, 'price');
  const gross = cents(row.amount, 'amount');
  const fee = cents(row.fee, 'fee', true), tax = cents(row.tax, 'tax', true);
  if (quantity === 0 || executionPrice < 0 || fee > 0 || tax > 0
    || (direction === 'buy' ? gross >= 0 : gross < 0))
    throw new Error('Inconsistent Trade Republic trade signs; review the source rather than reverse cash signs.');
  const result = {
    direction, quantity, source_quantity: sourceQuantity, signed_quantity: direction === 'sell' ? -quantity : quantity,
    currency: 'EUR', execution_price_eur: executionPrice,
    gross_cash_cents: gross, fee_cash_cents: fee, tax_cash_cents: tax, net_cash_cents: gross + fee + tax,
  };
  return { ...result, net_unit_price_eur: netTradeUnitPrice(result) };
}
