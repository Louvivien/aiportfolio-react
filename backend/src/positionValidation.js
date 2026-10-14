import { normaliseNumber } from './utils.js';

export function assertNonnegativeClosingPrices(body) {
  const values = [body.closing_price, ...(Array.isArray(body.purchase_lots)
    ? body.purchase_lots.map((lot) => lot?.closing_price ?? lot?.closingPrice) : [])];
  if (values.some((value) => normaliseNumber(value, NaN) < 0)) {
    throw Object.assign(new Error('Le prix de vente doit être positif ou nul ; le signe du mouvement de titres ne s’applique pas au prix.'), { status: 400 });
  }
}
