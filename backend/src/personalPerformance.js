// Consolidated account performance. Security trades are never external flows.
const DAY_MS = 86400000;
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const elapsedDays = (start, end) => (Date.parse(end) - Date.parse(start)) / DAY_MS;

export function solveXirr(flows) {
  const grouped = new Map();
  for (const flow of flows) {
    if (!validDate(flow.date) || !Number.isFinite(flow.amount)) throw new Error('Flux daté invalide.');
    grouped.set(flow.date, (grouped.get(flow.date) ?? 0) + flow.amount);
  }
  const entries = [...grouped].sort(([a], [b]) => a.localeCompare(b)).filter(([, value]) => value !== 0);
  if (entries.length < 2 || entries[0][1] >= 0 || entries.at(-1)[1] <= 0)
    throw new Error('Le TRI nécessite un investissement initial et une valeur finale positive.');
  // A negative cumulative investment before the final payment guarantees a
  // unique root. Refuse other patterns rather than choose an arbitrary IRR.
  let cumulative = 0;
  for (const [, value] of entries.slice(0, -1)) {
    cumulative += value;
    if (cumulative >= 0) throw new Error('Ces flux nécessitent une vérification du TRI : plusieurs solutions sont possibles.');
  }
  const start = entries[0][0];
  const times = entries.map(([date]) => elapsedDays(start, date) / 365);
  const scale = Math.max(...entries.map(([, value]) => Math.abs(value)));
  // Solve in log(1 + rate), keeping the mathematical domain rate > -1.
  const npv = (logRate) => {
    const exponents = times.map((time) => -time * logRate);
    const max = Math.max(...exponents);
    return entries.reduce((sum, [, value], i) => sum + value / scale * Math.exp(exponents[i] - max), 0);
  };
  let low = -32, high = 32;
  if (npv(low) <= 0 || npv(high) >= 0) throw new Error('Aucun TRI stable trouvé dans le domaine de calcul.');
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (npv(mid) > 0) low = mid; else high = mid;
  }
  const rate = Math.expm1((low + high) / 2);
  if (!Number.isFinite(rate) || rate <= -1) throw new Error('TRI non exploitable.');
  return rate;
}

export function calculatePersonalPerformance(evidence, opening, current, asOf) {
  const start = '2026-01-01';
  const missing = [];
  let blocked = false;
  const requireInput = (reason) => { blocked = true; missing.push(reason); };
  for (const issue of evidence?.accounting_reconciliation?.unresolved ?? []) {
    if (issue.blocks_return === true) requireInput(issue.description);
    else missing.push(issue.description);
  }
  if (!validDate(asOf) || asOf < start || asOf > '2026-12-31')
    throw new Error('La date de valorisation doit appartenir à 2026.');
  if (evidence?.flow_history_complete !== true) missing.push('Confirmer que tous les versements et retraits externes de 2026 sont enregistrés.');
  if (evidence?.transfers_reviewed !== true) missing.push('Vérifier les éventuels transferts internes pour éviter de les compter comme des flux externes.');
  if (evidence?.scope_complete !== true) missing.push('Confirmer que les positions couvrent tout le périmètre suivi, hors PER, Epsor et cryptomonnaies.');
  const openingCash = evidence?.opening_cash_eur;
  const currentCash = evidence?.current_cash_eur;
  if (!amount(openingCash)) requireInput('Renseigner le total des liquidités au 31/12/2025.');
  if (!amount(currentCash) || evidence?.current_cash_date !== asOf)
    requireInput(`Renseigner le total des liquidités au ${asOf}, à la même date que les titres.`);
  const openingValid = opening.complete === true && amount(opening.known_value_eur);
  const currentValid = current.complete === true && amount(current.known_value_eur);
  if (!openingValid) requireInput(`Compléter la valorisation des titres au 31/12/2025 : ${opening.missing_symbols.join(', ') || 'données manquantes'}.`);
  if (!currentValid) requireInput(`Compléter la valorisation actuelle des titres : ${current.missing_symbols.join(', ') || 'données manquantes'}.`);
  const initial = openingValid && amount(openingCash) ? opening.known_value_eur + openingCash : null;
  const final = currentValid && amount(currentCash) && evidence?.current_cash_date === asOf
    ? current.known_value_eur + currentCash : null;
  const flows = [];
  const movements = [];
  const seen = new Set();
  const totals = { personal_deposits_eur: 0, withdrawals_eur: 0, promotions_eur: 0 };
  for (const movement of evidence?.dated_movements ?? []) {
    if (seen.has(movement.id) || !movement.id) { requireInput('Un mouvement est dupliqué ou sans identifiant.'); continue; }
    seen.add(movement.id);
    if (['buy', 'sell', 'dividend', 'interest', 'fee', 'tax'].includes(movement.direction)) continue;
    if (movement.external_to_combined_scope === false) continue;
    if (movement.external_to_combined_scope !== true) { requireInput('La nature externe de certains mouvements reste à confirmer.'); continue; }
    if (!['deposit', 'withdrawal', 'promotion'].includes(movement.direction)) { requireInput('Un mouvement doit être classé.'); continue; }
    if (movement.currency !== 'EUR' || !Number.isSafeInteger(movement.amount_cents) || movement.amount_cents <= 0) {
      requireInput('Un montant doit être confirmé et converti en EUR à la date du flux.'); continue;
    }
    if (!validDate(movement.date)) { requireInput('La date de certains mouvements est manquante ou invalide.'); continue; }
    if (movement.date < start || movement.date > asOf) continue;
    if (movement.date_confirmed !== true) missing.push('Confirmer les dates de crédit effectives des versements Bourse Direct ; les dates connues sont celles d’émission.');
    const value = movement.amount_cents / 100;
    const key = movement.direction === 'deposit' ? 'personal_deposits_eur' : movement.direction === 'withdrawal' ? 'withdrawals_eur' : 'promotions_eur';
    totals[key] += value;
    flows.push({ date: movement.date, amount: movement.direction === 'withdrawal' ? value : -value });
    movements.push({ id: movement.id, date: movement.date, type: movement.direction, amount_eur: value, date_confirmed: movement.date_confirmed === true });
  }
  if (!evidence?.dated_movements) requireInput('Renseigner les flux externes datés.');
  const netPersonal = totals.personal_deposits_eur - totals.withdrawals_eur;
  const report = {
    label: 'Performance 2026', currency: 'EUR', period_start: start, opening_valuation_date: '2025-12-31', as_of: asOf,
    status: missing.length ? 'incomplete' : 'complete',
    opening: { ...opening, cash_eur: openingCash ?? null, total_eur: initial },
    current: { ...current, cash_eur: currentCash ?? null, cash_date: evidence?.current_cash_date ?? null, total_eur: final },
    flows: { ...totals, net_personal_eur: netPersonal, net_capital_eur: netPersonal + totals.promotions_eur, movements },
    missing: [...new Set(missing)], indicative: null, annualized_xirr: null, effective_return_pct: null, net_gain_eur: null,
    reconciliation_revision: evidence?.accounting_reconciliation?.revision ?? null,
    methodology: 'XIRR des flux externes consolidés en EUR, converti en rendement effectif depuis le 01/01/2026. La clôture du 31/12/2025 constitue le capital à l’ouverture du 01/01. Primes traitées comme apports ; achats, ventes et transferts internes exclus. Dividendes, intérêts et frais inclus uniquement via les soldes réels.',
  };
  if (blocked) return report;
  // Unconfirmed coverage and proxy credit dates allow only an explicitly
  // indicative result. Missing numerical inputs never allow a calculation.
  const result = missing.length ? {
    annualized_xirr: null, effective_return_pct: null, net_gain_eur: null,
    assumptions: [...report.missing],
  } : report;
  if (missing.length) report.indicative = result;
  result.net_gain_eur = final - initial - netPersonal - totals.promotions_eur;
  try {
    if (elapsedDays(start, asOf) <= 0) throw new Error('La période doit couvrir au moins un jour.');
    result.annualized_xirr = solveXirr([{ date: start, amount: -initial }, ...flows, { date: asOf, amount: final }]);
    result.effective_return_pct = Math.expm1(Math.log1p(result.annualized_xirr) * elapsedDays(start, asOf) / 365) * 100;
    if (Math.abs(result.effective_return_pct) < 1e-10) result.effective_return_pct = 0;
  } catch (error) {
    report.status = 'unavailable'; report.missing.push(error.message);
  }
  return report;
}
