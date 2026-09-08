import { planSale } from './salePlan.js';

const error = (status, message) => Object.assign(new Error(message), { status });
const timestamp = (value) => value ? new Date(value).toISOString() : null;
const requestKey = (sale) => JSON.stringify([sale.quantity, sale.price, sale.date, sale.lot_index ?? null]);

function checkedPlan(doc, sale) {
  if (sale.expected_updated_at !== timestamp(doc.updated_at))
    throw error(409, 'La position a changé. Actualise le portefeuille avant d’enregistrer la vente.');
  try { return planSale(doc, sale); } catch (err) { throw error(400, err.message); }
}

export async function previewSale({ positions }, id, sale) {
  const doc = await positions.findOne({ _id: id });
  if (!doc) throw error(404, 'Position introuvable.');
  const { allocations, proceeds, remaining_quantity } = checkedPlan(doc, sale);
  return { allocations, proceeds, remaining_quantity };
}

export async function recordSale({ positions, monthlyReports }, id, sale) {
  const doc = await positions.findOne({ _id: id });
  if (!doc) throw error(404, 'Position introuvable.');
  const existing = doc.recorded_sales?.find((entry) => entry.sale_id === sale.sale_id);
  if (existing) {
    if (existing.request_key !== requestKey(sale)) throw error(409, 'Cette vente a déjà été enregistrée avec d’autres valeurs. Actualise le portefeuille.');
    await monthlyReports.updateMany({}, { $set: { stale: true } });
    return { ok: true, sale_id: sale.sale_id };
  }
  const plan = checkedPlan(doc, sale);
  const open = plan.purchase_lots.filter((lot) => !lot.is_closed);
  const selected = open.length ? open : plan.purchase_lots;
  const total = selected.reduce((value, lot) => value + lot.quantity, 0);
  const cost = selected.reduce((value, lot) => value + lot.quantity * lot.cost_price, 0);
  const closedDates = plan.purchase_lots.map((lot) => lot.closing_date ? timestamp(lot.closing_date) : null);
  const updates = {
    purchase_lots: plan.purchase_lots, quantity: total, cost_price: cost / total,
    is_closed: open.length === 0,
    closing_price: open.length || plan.purchase_lots.some((lot) => lot.closing_price == null) ? null
      : plan.purchase_lots.reduce((value, lot) => value + lot.quantity * lot.closing_price, 0) / total,
    closing_date: open.length || closedDates.some((date) => !date) ? null : new Date(closedDates.sort().at(-1)),
    stop_loss_set: open.length > 0 && open.every((lot) => lot.stop_loss_set),
    updated_at: new Date(Math.max(Date.now(), new Date(doc.updated_at ?? 0).getTime() + 1)),
  };
  const result = await positions.updateOne(
    { _id: id, updated_at: doc.updated_at ?? null },
    { $set: updates, $push: { recorded_sales: { sale_id: sale.sale_id, request_key: requestKey(sale),
      quantity: sale.quantity, price: sale.price, date: sale.date, allocations: plan.allocations, created_at: updates.updated_at } } },
  );
  if (!result.matchedCount) {
    // An identical request can finish while this one is calculating. A retry is safe.
    const latest = await positions.findOne({ _id: id });
    const saved = latest?.recorded_sales?.find((entry) => entry.sale_id === sale.sale_id);
    if (!saved || saved.request_key !== requestKey(sale))
      throw error(409, 'La position a changé. Actualise le portefeuille avant d’enregistrer la vente.');
  }
  await monthlyReports.updateMany({}, { $set: { stale: true } });
  return { ok: true, sale_id: sale.sale_id };
}
