import type { PortfolioTotals, TotalMetric } from "../utils/portfolio";
import { formatCurrency, formatSignedPercent } from "../utils/format";

interface TotalsPanelProps {
  totals: PortfolioTotals;
  currency?: string;
}

const POSITIVE_BADGE = "#34a853";
const NEGATIVE_BADGE = "#d93025";

export function TotalsPanel({ totals, currency = "EUR" }: TotalsPanelProps) {
  const badgeColor = (value: number | null) => value === null ? "#64748b" : value >= 0 ? POSITIVE_BADGE : NEGATIVE_BADGE;
  const intradayColor = badgeColor(totals.portfolioIntradayPct);
  const tenDayColor = badgeColor(totals.tenDayPctTotal);
  const partial = (key: TotalMetric) => totals.coverage[key].missingLots > 0
    ? <small title={totals.coverage[key].issues.join("\n")} style={{ marginLeft: 6 }}>Partial</small> : null;
  const money = (value: number | null) => value === null ? "Unavailable" : formatCurrency(value, currency);
  const percentage = (value: number | null) => value === null ? "Unavailable" : formatSignedPercent(value);
  const issues = [...new Set(Object.values(totals.coverage).flatMap((entry) => entry.issues))];

  return (
    <div className="card">
      <div className="section-header">
        <h2>Totals</h2>
      </div>
      {issues.length > 0 && (
        <details style={{ marginBottom: 16 }}>
          <summary>Some records are incomplete — see what is missing</summary>
          <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </details>
      )}
      <div className="totals-layout">
        <div className="totals-primary">
          <div className="metric-card">
            <h4>Cost Basis (Open)</h4>
            <p>{money(totals.totalInvestAll)} {partial("open_cost")}</p>
          </div>
          <div className="metric-card">
            <h4>Total Market Value (Open)</h4>
            <p>{money(totals.totalMarketValueOpen)} {partial("market_value")}</p>
          </div>
          <div className="metric-card">
            <h4>Global P/L (Incl. Closed)</h4>
            <p>{money(totals.plVsInvestAll)} {partial("total_pl")}</p>
          </div>
          <div className="metric-card">
            <h4>P/L / Total Cost Basis</h4>
            <p>{percentage(totals.plPctVsInvestAll)} {partial("total_pl")}</p>
          </div>
        </div>
        <div className="totals-secondary">
          <div className="metric-card muted-block">
            <div className="muted-label">Realized P/L (All Sales)</div>
            <div className="muted-value">
              {money(totals.realizedPlClosed)} {partial("realized_pl")}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
        <span
          className="badge"
          style={{ background: intradayColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          Today P/L: {money(totals.intradayAbsSum)} (
          {percentage(totals.portfolioIntradayPct)}) {partial("intraday")}
        </span>
        <span
          className="badge"
          style={{ background: tenDayColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          10D P/L: {money(totals.tenDayAbsolute)} (
          {percentage(totals.tenDayPctTotal)}) {partial("ten_day")}
        </span>
      </div>
    </div>
  );
}

export default TotalsPanel;
