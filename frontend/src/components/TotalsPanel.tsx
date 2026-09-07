import type { PortfolioTotals } from "../utils/portfolio";
import { formatCurrency, formatSignedPercent } from "../utils/format";

interface TotalsPanelProps {
  totals: PortfolioTotals;
  currency?: string;
}

const POSITIVE_BADGE = "#34a853";
const NEGATIVE_BADGE = "#d93025";

export function TotalsPanel({ totals, currency = "EUR" }: TotalsPanelProps) {
  const intradayColor = (totals.portfolioIntradayPct ?? 0) >= 0 ? POSITIVE_BADGE : NEGATIVE_BADGE;
  const tenDayColor = (totals.tenDayPctTotal ?? 0) >= 0 ? POSITIVE_BADGE : NEGATIVE_BADGE;
  const oneYearColor = (totals.oneYearPctTotal ?? 0) >= 0 ? POSITIVE_BADGE : NEGATIVE_BADGE;

  return (
    <div className="card">
      <div className="section-header">
        <h2>Totals</h2>
      </div>
      <p className="muted">EUR estimates using dated ECB rates. Period percentages are lot P/L divided by
        opening value plus purchases during the period, including closed lots. They are not account returns.
        Cash, fees and dividends are excluded. Missing prices, dates or FX show as —.</p>
      <div className="totals-layout">
        <div className="totals-primary">
          <div className="metric-card">
            <h4>Cost Basis (Open)</h4>
            <p>{formatCurrency(totals.totalInvestAll, currency)}</p>
          </div>
          <div className="metric-card">
            <h4>Total Market Value (Open)</h4>
            <p>{formatCurrency(totals.totalMarketValueOpen, currency)}</p>
          </div>
          <div className="metric-card">
            <h4>Global P/L (Incl. Closed)</h4>
            <p>{formatCurrency(totals.plVsInvestAll, currency)}</p>
          </div>
          <div className="metric-card">
            <h4>P/L / Total Cost Basis</h4>
            <p>{formatSignedPercent(totals.plPctVsInvestAll)}</p>
          </div>
        </div>
        <div className="totals-secondary">
          <div className="metric-card muted-block">
            <div className="muted-label">Realized P/L (All Closed Lots)</div>
            <div className="muted-value">
              {formatCurrency(totals.realizedPlClosed, currency)}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
        <span
          className="badge"
          style={{ background: intradayColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          Today lot P/L: {formatCurrency(totals.intradayAbsSum, currency)} (
          {formatSignedPercent(totals.portfolioIntradayPct)})
        </span>
        <span
          className="badge"
          style={{ background: tenDayColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          10D lot P/L: {formatCurrency(totals.tenDayAbsolute, currency)} (
          {formatSignedPercent(totals.tenDayPctTotal)})
        </span>
        <span
          className="badge"
          style={{ background: oneYearColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          1Y lot P/L: {formatCurrency(totals.oneYearAbsolute, currency)} (
          {formatSignedPercent(totals.oneYearPctTotal)})
        </span>
      </div>
    </div>
  );
}

export default TotalsPanel;
