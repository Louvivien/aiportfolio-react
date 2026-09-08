import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Position } from "../api/types";
import { previewPositionSale } from "../api/client";
import type { SalePreview, SaleRequest } from "../api/sales";
import { formatCurrency, formatDate } from "../utils/format";

interface Props {
  position: Position;
  loading: boolean;
  onClose: () => void;
  onSubmit: (id: string, sale: SaleRequest) => Promise<void>;
}

export default function SellPositionModal({ position, loading, onClose, onSubmit }: Props) {
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [allocation, setAllocation] = useState("oldest");
  const [error, setError] = useState<string | null>(null);
  const [saleId] = useState(() => crypto.randomUUID());
  const [attempt, setAttempt] = useState(0);
  const [previewState, setPreviewState] = useState<{ key: string; data: SalePreview | null; error: string | null } | null>(null);
  const submitting = useRef(false);
  const lots = position.purchase_lots?.length ? position.purchase_lots : [position];
  const open = lots.map((lot, index) => ({ lot, index })).filter(({ lot }) => !lot.is_closed);
  const available = open.reduce((sum, { lot }) => sum + lot.quantity, 0);
  const currency = position.currency;
  const money = (value: number) => currency ? formatCurrency(value, currency) : `${value.toFixed(2)} (devise du titre)`;
  const sale: SaleRequest = useMemo(() => ({ sale_id: saleId, quantity: quantity.trim() ? Number(quantity.replace(',', '.')) : NaN,
    price: price.trim() ? Number(price.replace(',', '.')) : NaN, date,
    lot_index: allocation === "oldest" ? null : Number(allocation), expected_updated_at: position.updated_at ?? null }),
    [saleId, quantity, price, date, allocation, position.updated_at]);
  const key = JSON.stringify([sale, attempt]);
  const hasInputs = Boolean(quantity.trim() && price.trim() && date);
  const preview = previewState?.key === key ? previewState.data : null;
  const validation = previewState?.key === key ? previewState.error : null;
  useEffect(() => {
    if (!hasInputs || !position.id) return;
    let active = true;
    const timer = setTimeout(() => {
      previewPositionSale(position.id!, sale).then(
        (data) => { if (active) setPreviewState({ key, data, error: null }); },
        (err) => { if (active) setPreviewState({ key, data: null, error: err.message }); },
      );
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [hasInputs, position.id, key, sale]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || !position.id || submitting.current) return;
    submitting.current = true;
    setError(null);
    try { await onSubmit(position.id, sale); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'La vente n’a pas pu être enregistrée.'); }
    finally { submitting.current = false; }
  };
  return <div className="overlay">
    <div className="modal sale-modal" role="dialog" aria-modal="true" aria-labelledby="sale-title">
      <div className="section-header">
        <h3 id="sale-title">Enregistrer une vente — {position.display_name || position.symbol}</h3>
        <button type="button" className="btn ghost" onClick={onClose} disabled={loading}>Fermer</button>
      </div>
      <p>{available} action(s) actuellement détenue(s). Cette saisie met à jour ton suivi de portefeuille.</p>
      <form onSubmit={submit}>
        <fieldset disabled={loading} className="sale-fields">
          <label htmlFor="sale-quantity">Quantité vendue</label>
          <input autoFocus id="sale-quantity" inputMode="decimal" required value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Ex. 10" />
          <label htmlFor="sale-price">Prix de vente par action {currency ? `(${currency})` : ''}</label>
          <input id="sale-price" inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} />
          <label htmlFor="sale-date">Date de vente</label>
          <input id="sale-date" type="date" required max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
          <label htmlFor="sale-allocation">Actions à vendre</label>
          <select id="sale-allocation" value={allocation} onChange={(e) => setAllocation(e.target.value)}>
            <option value="oldest">Automatique — achats les plus anciens d’abord</option>
            {open.map(({ lot, index }) => <option key={index} value={index}>
              Achat {index + 1} : {lot.quantity} action(s) du {formatDate(lot.purchase_date ?? null)} à {money(lot.cost_price)}
            </option>)}
          </select>
        </fieldset>
        {preview && <div className="sale-preview" aria-live="polite">
          <strong>Après la vente : {preview.remaining_quantity} action(s) restante(s)</strong>
          <p>Montant de la vente : {money(preview.proceeds)} avant frais.</p>
          <ul>{preview.allocations.map((item) => <li key={item.lot_index}>
            {item.quantity} action(s) de l’achat du {formatDate(item.purchase_date)} à {money(item.cost_price)}
          </li>)}</ul>
        </div>}
        {hasInputs && !preview && !validation && <p role="status">Calcul de la répartition…</p>}
        {validation && <div role="alert">
          <p className="error-text">{validation}</p>
          <button type="button" className="btn secondary" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>Réessayer l’aperçu</button>
        </div>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="sale-actions">
          <button type="submit" className="btn" disabled={loading || !preview || !position.id}>{loading ? 'Enregistrement…' : 'Enregistrer la vente'}</button>
          <button type="button" className="btn secondary" onClick={onClose} disabled={loading}>Annuler</button>
        </div>
      </form>
    </div>
  </div>;
}
