// Used for both the sale preview and persistence so the allocation stays consistent.
const day = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const quantity = (value) => Math.round(value * 1e8) / 1e8;
const fail = (message) => { throw new Error(message); };

export function saleLots(position) {
  return position.purchase_lots?.length ? position.purchase_lots : [{
    id: 'lot-1', quantity: position.quantity, cost_price: position.cost_price,
    purchase_date: position.purchase_date, is_closed: position.is_closed,
    closing_price: position.closing_price, closing_date: position.closing_date,
    stop_loss_set: position.stop_loss_set,
  }];
}

export function planSale(position, sale, today = new Date().toISOString().slice(0, 10)) {
  if (position.is_closed) fail('Cette position est déjà entièrement vendue.');
  if (typeof sale.quantity !== 'number' || !Number.isFinite(sale.quantity) || sale.quantity <= 0 ||
      quantity(sale.quantity) !== sale.quantity) fail('Saisis une quantité positive (8 décimales maximum).');
  if (typeof sale.price !== 'number' || !Number.isFinite(sale.price) || sale.price < 0)
    fail('Saisis un prix de vente par action positif ou nul.');
  if (typeof sale.date !== 'string' || !validDate(sale.date) || sale.date > today)
    fail('Saisis une date de vente valide, au plus tard aujourd’hui.');
  if (typeof sale.sale_id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(sale.sale_id)) fail('Identifiant de vente invalide.');
  const lots = saleLots(position);
  if (lots.some((lot) => typeof lot.quantity !== 'number' || !Number.isFinite(lot.quantity) || lot.quantity <= 0 ||
      typeof lot.cost_price !== 'number' || !Number.isFinite(lot.cost_price) || lot.cost_price < 0))
    fail('Corrige les quantités et prix d’achat avant d’enregistrer la vente.');
  const open = lots.map((lot, index) => ({ lot, index })).filter(({ lot }) => !lot.is_closed);
  const specific = sale.lot_index !== null && sale.lot_index !== undefined;
  if (specific && (!Number.isInteger(sale.lot_index) || !open.some(({ index }) => index === sale.lot_index)))
    fail('Cet achat n’est pas disponible pour la vente.');
  let eligible = specific ? open.filter(({ index }) => index === sale.lot_index) : open;
  if (eligible.some(({ lot }) => !validDate(day(lot.purchase_date))))
    fail('Renseigne la date des achats concernés avant d’enregistrer cette vente.');
  eligible = eligible.filter(({ lot }) => day(lot.purchase_date) <= sale.date)
    .sort((a, b) => day(a.lot.purchase_date).localeCompare(day(b.lot.purchase_date)) || a.index - b.index);
  const available = quantity(eligible.reduce((total, { lot }) => total + lot.quantity, 0));
  if (sale.quantity > available) fail(`Seulement ${available} action(s) disponible(s) pour cet achat ou cette date.`);
  let remaining = sale.quantity;
  const allocations = [];
  const taken = new Map();
  for (const { lot, index } of eligible) {
    if (remaining <= 0) break;
    const sold = Math.min(remaining, lot.quantity);
    taken.set(index, sold);
    allocations.push({ lot_index: index, quantity: sold, purchase_date: day(lot.purchase_date), cost_price: lot.cost_price });
    remaining = quantity(remaining - sold);
  }
  const purchase_lots = lots.flatMap((lot, index) => {
    const sold = taken.get(index);
    if (!sold) return [{ ...lot }];
    const closing = { ...lot, quantity: sold, is_closed: true, stop_loss_set: false,
      closing_price: sale.price, closing_date: sale.date, sale_id: sale.sale_id };
    if (sold === lot.quantity) return [closing];
    return [{ ...lot, quantity: quantity(lot.quantity - sold) },
      { ...closing, id: `sale-${sale.sale_id}-${index}` }];
  });
  const proceeds = sale.quantity * sale.price;
  if (!Number.isFinite(proceeds)) fail('Le montant de la vente est trop élevé.');
  return { purchase_lots, allocations, proceeds,
    remaining_quantity: quantity(open.reduce((total, { lot }) => total + lot.quantity, 0) - sale.quantity) };
}
