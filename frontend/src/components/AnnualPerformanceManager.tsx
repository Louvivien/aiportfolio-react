import { useEffect, useRef, useState } from 'react';
import { fetchAnnualManagement, updateAnnualInputs, prepareNextPerformanceYear, previewPerformanceClose, commitPerformanceClose, reopenPerformanceYear, fetchAnnualAudit } from '../api/client';
import type { AnnualManagement, AnnualPerformanceInput, AnnualSnapshot, AnnualClosePreview, PerformanceMovement } from '../api/performance';
import { formatCurrency } from '../utils/format';
import './AnnualPerformanceManager.css';

const precise = (value: number | null | undefined) => typeof value === 'number' ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 }).format(value) : '—';
const money = (value: number | null | undefined) => typeof value === 'number' ? formatCurrency(value, 'EUR') : '—';
function euros(value: string) {
  const parsed = Number(value.replace(',', '.'));
  if (!value.trim() || !Number.isFinite(parsed) || parsed < 0 || Math.abs(parsed * 100 - Math.round(parsed * 100)) > 1e-6) throw new Error('Saisir un montant en euros, au centime, positif ou nul.');
  return parsed;
}
const errorMessage = (error: unknown) => {
  const e = error as { response?: { data?: { error?: string; message?: string; detail?: string } }; message?: string };
  return e.response?.data?.detail ?? e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Impossible d’enregistrer.';
};
function Snapshot({ snapshot }: { snapshot: AnnualSnapshot }) {
  return <><p>Titres : <strong>{money(snapshot.known_value_eur)}</strong> · Espèces : <strong>{money(snapshot.cash_eur)}</strong> · Total : <strong>{money(snapshot.total_eur)}</strong></p>
    <div className="annual-table"><table><thead><tr><th>Symbole</th><th>Quantité</th><th>Cours</th><th>Date du cours</th><th>Change vers EUR</th><th>Valeur EUR</th></tr></thead>
      <tbody>{snapshot.positions?.map((p) => <tr key={p.position_id}><td>{p.symbol}</td><td>{precise(p.quantity)}</td><td>{precise(p.price) ?? '—'} {p.currency}</td><td>{p.price_date ?? '—'}</td><td>{p.fx ? `${p.fx.rate.toFixed(6)} (${p.fx.date})` : '—'}</td><td>{money(p.value_eur)}</td></tr>)}</tbody></table></div>
    {!!snapshot.missing_symbols?.length && <p>Données à vérifier : {snapshot.missing_symbols.join(', ')}</p>}</>;
}
export default function AnnualPerformanceManager({ year, onYear, onClose, onChange }: {
  year: number; onYear: (year: number) => void; onClose: () => void; onChange: () => void;
}) {
  const [data, setData] = useState<AnnualManagement | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cash, setCash] = useState(''), [cashDate, setCashDate] = useState(''), [openingCash, setOpeningCash] = useState(''), [openingStatus, setOpeningStatus] = useState('estimated');
  const [flow, setFlow] = useState<PerformanceMovement | null>(null), [flowAmount, setFlowAmount] = useState('');
  const [closeCash, setCloseCash] = useState(''), [preview, setPreview] = useState<AnnualClosePreview | null>(null), [updateNext, setUpdateNext] = useState(false), [reopen, setReopen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const init = (value: AnnualManagement) => {
    setData(value); setCash(value.input.current_cash_eur?.toString() ?? ''); setCashDate(value.input.current_cash_date ?? '');
    setOpeningCash(value.input.opening_cash_eur?.toString() ?? ''); setOpeningStatus(value.input.opening_cash_status ?? 'user_confirmed');
  };
  useEffect(() => {
    let active = true; setLoading(true); setData(null); setError(''); setNotice(''); setFlow(null); setPreview(null); setCloseCash(''); setReopen(false);
    fetchAnnualManagement(year).then((v) => { if (active) init(v); }).catch((e) => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [year]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const run = async (action: () => Promise<unknown>, success: string, reload = true) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (reload) { init(await fetchAnnualManagement(year)); setPreview(null); onChange(); } setNotice(success); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const save = (patch: Partial<AnnualPerformanceInput>) => updateAnnualInputs(year, data!.revision, patch);
  const startFlow = (existing?: PerformanceMovement) => {
    setFlow(existing ?? { id: crypto.randomUUID(), date: data!.today > `${year}-12-31` ? `${year}-12-31` : data!.today, direction: 'deposit', amount_cents: 0, currency: 'EUR', external_to_combined_scope: true, date_confirmed: true, note: '' });
    setFlowAmount(existing ? (existing.amount_cents / 100).toString() : '');
  };
  const disabled = busy || loading;
  return <div className="overlay annual-overlay"><div className="modal annual-manager" role="dialog" aria-modal="true" aria-labelledby="annual-title" tabIndex={-1} ref={dialog}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]') ?? [])].filter((el) => el.getClientRects().length);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="annual-heading"><h2 id="annual-title">Gérer la performance annuelle</h2><button type="button" onClick={onClose} disabled={busy}>Fermer</button></div>
    <label>Année <select aria-label="Année" value={year} disabled={disabled} onChange={(e) => onYear(Number(e.target.value))}>{(data?.years ?? [year]).map((y) => <option key={y}>{y}</option>)}</select></label>
    {loading && <p role="status">Chargement des valorisations…</p>}
    {error && <p role="alert" className="annual-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data && <>
      <p>{data.closed ? 'Année clôturée : calcul et valorisations conservés.' : 'Les positions enregistrées alimentent les valorisations. Les flux et les espèces se renseignent ici, en EUR.'}</p>
      <details><summary>Situation initiale au 31/12/{year - 1}</summary>
        <Snapshot snapshot={{ ...data.opening_snapshot, cash_eur: data.report.opening.cash_eur, total_eur: data.report.opening.total_eur }} />
        {data.opening_source_year ? <p>Issue de la clôture {data.opening_source_year}. Pour la corriger, réouvrir cette clôture puis valider la mise à jour de l’ouverture suivante.</p>
          : <form onSubmit={(e) => { e.preventDefault(); void run(() => save({ opening_cash_eur: euros(openingCash), opening_cash_status: openingStatus }), 'Liquidités initiales enregistrées.'); }}>
            <label>Espèces initiales (€)<input type="text" inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} required disabled={disabled || data.closed} /></label>
            <label>Source<select value={openingStatus} onChange={(e) => setOpeningStatus(e.target.value)} disabled={disabled || data.closed}><option value="estimated">Hypothèse</option><option value="user_confirmed">Solde confirmé</option><option value="documented">Justificatif vérifié</option></select></label>
            <button disabled={disabled || data.closed}>Enregistrer les espèces initiales</button></form>}
      </details>
      <details open><summary>Versements, retraits et primes</summary>
        <p>Achats, ventes, dividendes, intérêts et frais ne sont pas des flux externes. Un transfert entre les placements inclus est exclu du calcul.</p>
        <div className="annual-table"><table><thead><tr><th>Date</th><th>Mouvement</th><th>Montant</th><th>Traitement</th><th>Actions</th></tr></thead><tbody>
          {data.input.dated_movements.map((m) => <tr key={m.id}><td>{m.date}{!m.date_confirmed && ' (à confirmer)'}</td><td>{({ deposit: 'Versement', withdrawal: 'Retrait', promotion: 'Prime' })[m.direction]}</td><td>{money(m.amount_cents / 100)}</td><td>{m.external_to_combined_scope ? 'Externe' : 'Interne, exclu'}</td><td>
            <button disabled={disabled || data.closed} onClick={() => startFlow(m)}>Modifier</button>{' '}<button disabled={disabled || data.closed} onClick={() => void run(() => save({ dated_movements: data.input.dated_movements.filter((v) => v.id !== m.id) }), 'Flux supprimé ; ancienne valeur conservée dans l’audit. Confirmer les espèces.')}>Supprimer</button>
          </td></tr>)}</tbody></table></div>
        {!flow && <button disabled={disabled || data.closed || data.today < `${year}-01-01`} onClick={() => startFlow()}>Ajouter un flux</button>}
        {flow && <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const amount = euros(flowAmount); if (amount <= 0) throw new Error('Le montant du flux doit être supérieur à zéro.');
          const updated = { ...flow, amount_cents: Math.round(amount * 100) };
          await save({ dated_movements: [...data.input.dated_movements.filter((m) => m.id !== flow.id), updated].sort((a, b) => a.date.localeCompare(b.date)) }); setFlow(null);
        }, 'Flux enregistré. Confirmer le solde des espèces après ce mouvement.'); }}>
          <label>Date<input type="date" min={`${year}-01-01`} max={data.today < `${year}-12-31` ? data.today : `${year}-12-31`} value={flow.date} onChange={(e) => setFlow({ ...flow, date: e.target.value })} required /></label>
          <label>Type<select value={flow.direction} onChange={(e) => setFlow({ ...flow, direction: e.target.value as PerformanceMovement['direction'] })}><option value="deposit">Versement</option><option value="withdrawal">Retrait</option><option value="promotion">Crédit promotionnel</option></select></label>
          <label>Montant (€)<input inputMode="decimal" value={flowAmount} onChange={(e) => setFlowAmount(e.target.value)} required /></label>
          <label>Note<input value={flow.note ?? ''} maxLength={1000} onChange={(e) => setFlow({ ...flow, note: e.target.value })} /></label>
          <label><input type="checkbox" checked={flow.date_confirmed} onChange={(e) => setFlow({ ...flow, date_confirmed: e.target.checked })} /> Date effective confirmée</label>
          <label><input type="checkbox" checked={!flow.external_to_combined_scope} onChange={(e) => setFlow({ ...flow, external_to_combined_scope: !e.target.checked })} /> Transfert interne au périmètre suivi (exclu du rendement)</label>
          <button disabled={disabled}>Enregistrer le flux</button><button type="button" disabled={disabled} onClick={() => setFlow(null)}>Annuler</button>
        </form>}
      </details>
      <details open><summary>Liquidités globales</summary>
        <p>Le dernier solde connu est repris tant que les opérations et les flux enregistrés n’ont pas changé : aucune confirmation quotidienne n’est nécessaire. Sa date et cette hypothèse restent dans l’audit. Actualiser le solde après une opération, un dividende, des intérêts, des frais ou une taxe. Aucun flux n’est ajouté automatiquement au montant saisi. Il doit couvrir le même périmètre que les titres.</p>
        <form onSubmit={(e) => { e.preventDefault(); void run(() => save({ current_cash_eur: euros(cash), current_cash_date: cashDate }), 'Solde des espèces confirmé.'); }}>
          <label>Total des espèces (€)<input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} required disabled={disabled || data.closed} /></label>
          <label>Date du solde<input type="date" value={cashDate} min={`${year}-01-01`} max={data.today < `${year}-12-31` ? data.today : `${year}-12-31`} onChange={(e) => setCashDate(e.target.value)} required disabled={disabled || data.closed} /></label>
          <button disabled={disabled || data.closed || data.today < `${year}-01-01`}>Confirmer les liquidités</button>
        </form>
      </details>
      <details><summary>Vérification et audit</summary>
        <p>{data.report.methodology}</p><p>Symboles exclus : {data.input.performance_scope?.excluded_symbols?.join(', ') || 'aucun'}. Le périmètre actuel est reconduit à l’ouverture suivante.</p>
        {data.report.missing.length ? <ul>{data.report.missing.map((m, i) => <li key={i}>{m}</li>)}</ul> : <p>Les données nécessaires au calcul sont renseignées.</p>}
        {(['flow_history_complete', 'transfers_reviewed', 'scope_complete'] as const).map((key) => <label key={key} className="annual-check"><input type="checkbox" checked={data.input[key] === true} disabled={disabled || data.closed}
          onChange={(e) => void run(() => save({ [key]: e.target.checked }), 'Confirmation enregistrée.')} />{({ flow_history_complete: 'Tous les flux externes de la période sont enregistrés', transfers_reviewed: 'Les transferts internes ont été vérifiés', scope_complete: 'Les positions couvrent le périmètre choisi' })[key]}</label>)}
        <button disabled={disabled} onClick={() => void run(async () => {
          const audit = await fetchAnnualAudit(year); const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = `audit-performance-${year}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'Audit JSON téléchargé.', false)}>Exporter l’audit JSON</button>
      </details>
      <details><summary>Clôture et année suivante</summary>
        <button disabled={disabled} onClick={() => void run(async () => { await prepareNextPerformanceYear(year, data.revision); }, `L’année ${year + 1} est préparée. Son capital initial sera renseigné lors de la clôture ${year}.`)}>Préparer {year + 1}</button>
        {data.today <= `${year}-12-31` ? <p>La clôture {year} sera disponible à partir du 01/01/{year + 1}. Elle utilisera les quantités au 31 décembre, les derniers cours disponibles à cette date et les liquidités confirmées.</p>
          : data.closed ? <><Snapshot snapshot={data.closing_snapshot!} /><p>Réouvrir conserve l’ancienne clôture dans l’audit et suspend le calcul de l’année suivante jusqu’à validation de sa nouvelle ouverture.</p>
            {reopen ? <><button disabled={disabled} onClick={() => void run(async () => { await reopenPerformanceYear(year, data.revision); setReopen(false); }, 'Année réouverte. Corriger les données puis préparer une nouvelle clôture.')}>Confirmer la réouverture</button><button disabled={disabled} onClick={() => setReopen(false)}>Annuler</button></> : <button disabled={disabled} onClick={() => setReopen(true)}>Réouvrir pour corriger</button>}</>
          : <form onSubmit={(e) => { e.preventDefault(); void run(async () => { setPreview(await previewPerformanceClose(year, data.revision, euros(closeCash))); setUpdateNext(false); }, 'Vérifier la clôture proposée avant validation.', false); }}>
            <label>Espèces au 31/12/{year} (€)<input inputMode="decimal" value={closeCash} onChange={(e) => { setCloseCash(e.target.value); setPreview(null); }} required /></label><button disabled={disabled}>Prévisualiser la clôture</button>
          </form>}
        {preview && <section><Snapshot snapshot={preview.snapshot} />
          <p>Gain : {money((preview.report.indicative ?? preview.report).net_gain_eur)}. Les cours antérieurs au 31 décembre restent datés dans la photographie ; vérifier leur pertinence avant validation.</p>
          {!!preview.report.missing.length && <ul>{preview.report.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {preview.updates_next_opening && <label className="annual-check"><input type="checkbox" checked={updateNext} onChange={(e) => setUpdateNext(e.target.checked)} /> Mettre aussi à jour l’ouverture {year + 1} avec cette clôture corrigée</label>}
          <button disabled={disabled || !preview.snapshot.complete || (preview.updates_next_opening && !updateNext)} onClick={() => void run(() => commitPerformanceClose(year, preview._id, updateNext), `Clôture ${year} et ouverture ${year + 1} enregistrées.`)}>Valider la clôture et l’ouverture suivante</button>
        </section>}
      </details>
    </>}
  </div></div>;
}
