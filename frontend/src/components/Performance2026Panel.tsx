import { useEffect, useState } from "react";
import { fetchPersonalPerformance2026 } from "../api/client";
import type { PersonalPerformance } from "../api/performance";
import { formatCurrency, formatDate, formatSignedPercent } from "../utils/format";
import { downloadJson } from "../utils/export";

export function Performance2026Result({ report }: { report: PersonalPerformance }) {
  const money = (value: number | null) => value === null ? "À renseigner" : formatCurrency(value, "EUR");
  const indicative = report.indicative;
  const result = indicative ?? (report.status !== "incomplete" ? report : null);
  const rate = result?.effective_return_pct ?? null;
  const gain = result?.net_gain_eur ?? null;
  return <>
    <p className="muted">Du 1er janvier 2026 au {formatDate(report.as_of)} · Ensemble des comptes suivis, en EUR</p>
    <div className="totals-primary">
      <div className="metric-card">
        <h4>Performance 2026</h4>
        <p>{rate !== null ? formatSignedPercent(rate) : "—"}</p>
      </div>
      <div className="metric-card">
        <h4>Gain 2026 (€)</h4>
        <p>{gain !== null ? money(gain) : "—"}</p>
      </div>
    </div>
    {indicative && (rate !== null || gain !== null) && <p className="muted">Indicatif · Calculé à partir des positions et des flux enregistrés.</p>}
    <details style={{ marginTop: 16 }}>
      <summary>Données et hypothèses du calcul</summary>
      {report.missing.length > 0 && <div style={{ marginTop: 12 }}>
        <strong>{indicative ? "Hypothèses à confirmer" : "Données nécessaires au calcul"}</strong>
        <ul>{report.missing.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>}
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="table">
          <thead><tr><th>Élément</th><th>Montant</th></tr></thead>
          <tbody>
            <tr><td>Titres reconstitués au 31/12/2025{!report.opening.complete ? " (partiel)" : ""}</td><td>{money(report.opening.known_value_eur)}</td></tr>
            <tr><td>Liquidités au 31/12/2025</td><td>{money(report.opening.cash_eur)}</td></tr>
            <tr><td>Titres actuels{!report.current.complete ? " (partiel)" : ""}</td><td>{money(report.current.known_value_eur)}</td></tr>
            <tr><td>Liquidités actuelles</td><td>{money(report.current.cash_eur)}</td></tr>
            <tr><td>Versements personnels identifiés</td><td>{money(report.flows.personal_deposits_eur)}</td></tr>
            <tr><td>Retraits externes identifiés</td><td>{money(report.flows.withdrawals_eur)}</td></tr>
            <tr><td>Primes exclues des gains</td><td>{money(report.flows.promotions_eur)}</td></tr>
            <tr><td>Apports nets identifiés, primes comprises</td><td>{money(report.flows.net_capital_eur)}</td></tr>
          </tbody>
        </table>
        <table className="table" style={{ marginTop: 16 }}>
          <thead><tr><th>Date</th><th>Mouvement</th><th>Montant</th><th>Date confirmée</th></tr></thead>
          <tbody>{report.flows.movements.map((flow) => <tr key={flow.id}>
            <td>{formatDate(flow.date)}</td>
            <td>{flow.type === "deposit" ? "Versement" : flow.type === "withdrawal" ? "Retrait" : "Prime promotionnelle"}</td>
            <td>{money(flow.amount_eur)}</td><td>{flow.date_confirmed ? "Oui" : "Émission connue, crédit à confirmer"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="muted">{report.methodology}</p>
      <button className="btn secondary" type="button" onClick={() => downloadJson(`performance_2026_${report.as_of}.json`, report)}>Exporter le calcul 2026</button>
    </details>
  </>;
}

export default function Performance2026Panel({ revision }: { revision: string }) {
  const [report, setReport] = useState<PersonalPerformance | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setReport(null); setError(false);
    fetchPersonalPerformance2026().then((data) => { if (active) setReport(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision, attempt]);
  return <div className="card">
    <div className="section-header"><h2>Performance 2026</h2></div>
    {error ? <p role="alert">Le calcul n’a pas pu être chargé. <button type="button" className="btn secondary" onClick={() => setAttempt((n) => n + 1)}>Réessayer</button></p>
      : report ? <Performance2026Result report={report} /> : <p role="status">Reconstitution des valorisations et vérification des flux…</p>}
  </div>;
}
