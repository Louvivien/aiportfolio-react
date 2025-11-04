import type { PortfolioTotals } from "../utils/portfolio";
import { formatCurrency, formatSignedPercent } from "../utils/format";

interface TotalsPanelProps {
  totals: PortfolioTotals;
  currency?: string;
}

const POSITIVE_BADGE = "#34a853";
const NEGATIVE_BADGE = "#d93025";

export function TotalsPanel({ totals, currency = "EUR" }: TotalsPanelProps) {
  const intradayColor = totals.portfolioIntradayPct >= 0 ? POSITIVE_BADGE : NEGATIVE_BADGE;
  const tenDayColor = totals.tenDayPctTotal >= 0 ? POSITIVE_BADGE : NEGATIVE_BADGE;

  return (
    <div className="card">
      <div className="section-header">
        <h2>Totals</h2>
      </div>
      <div className="grid two">
        <div className="metric-card">
          <h4>Total Invest (Open)</h4>
          <p>{formatCurrency(totals.totalInvestAll, currency)}</p>
        </div>
        <div className="metric-card">
          <h4>Total Market Value (Open)</h4>
          <p>{formatCurrency(totals.totalMarketValueOpen, currency)}</p>
        </div>
        <div className="metric-card">
          <h4>Total Invest (Closed)</h4>
          <p>{formatCurrency(totals.totalInvestClosed, currency)}</p>
        </div>
        <div className="metric-card">
          <h4>Realized P/L (Closed)</h4>
          <p>{formatCurrency(totals.realizedPlClosed, currency)}</p>
        </div>
        <div className="metric-card">
          <h4>P/L (Global vs Invest All)</h4>
          <p>{formatCurrency(totals.plVsInvestAll, currency)}</p>
        </div>
        <div className="metric-card">
          <h4>P/L % (vs Invest All)</h4>
          <p>{formatSignedPercent(totals.plPctVsInvestAll)}</p>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
        <span
          className="badge"
          style={{ background: intradayColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          Intraday (Open): {formatCurrency(totals.intradayAbsSum, currency)} (
          {formatSignedPercent(totals.portfolioIntradayPct)})
        </span>
        <span
          className="badge"
          style={{ background: tenDayColor, color: "#fff", fontSize: 14, padding: "6px 12px" }}
        >
          10D (Open): {formatCurrency(totals.tenDayAbsolute, currency)} (
          {formatSignedPercent(totals.tenDayPctTotal)})
        </span>
      </div>
    </div>
  );
}

export default TotalsPanel;
