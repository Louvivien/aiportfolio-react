import { useCallback } from "react";
import type { Position, TagSummaryRow } from "../api/types";
import type { PortfolioTotals, PositionRow } from "../utils/portfolio";
import { downloadCsv, downloadJson, timestampForFilename } from "../utils/export";

interface ExportPanelProps {
  positions: PositionRow[];
  rawPositions: Position[];
  tagSummary: TagSummaryRow[];
  totals: PortfolioTotals;
}

const POSITION_COLUMNS = [
  "id",
  "symbol",
  "display_name",
  "api_url",
  "long_name",
  "purchase_date",
  "is_closed",
  "closing_price",
  "closing_date",
  "quantity",
  "cost_price",
  "stop_price",
  "current_price",
  "effective_price",
  "invested",
  "current_value",
  "pnl_value",
  "pnl_percent",
  "currency",
  "market_value_eur",
  "realized_pl_eur",
  "fx_date",
  "fx_rate_to_eur",
  "intraday_change",
  "intraday_change_pct",
  "intraday_abs",
  "price_10d",
  "security_change_10d_pct",
  "ten_day_percent",
  "price_1y",
  "security_change_1y_pct",
  "one_year_percent",
  "tags",
  "boursorama_forum_url",
];

const TAG_COLUMNS = [
  "tag",
  "total_quantity",
  "total_market_value",
  "allocation_pct",
  "total_unrealized_pl",
  "intraday_change_pct",
  "change_10d_pct",
  "change_1y_pct",
];

export function ExportPanel({ positions, rawPositions, tagSummary, totals }: ExportPanelProps) {
  const exportPositions = useCallback(() => {
    const stamp = timestampForFilename();
    const rows = positions.map((row) => {
      const p = row.position;
      const tags = Array.isArray(p.tags) ? p.tags.join(", ") : "";
      return {
        id: p.id ?? p._id ?? "",
        symbol: p.symbol,
        display_name: p.display_name ?? "",
        api_url: p.api_url ?? null,
        long_name: p.long_name ?? "",
        purchase_date: p.purchase_date ?? p.created_at ?? "",
        is_closed: Boolean(p.is_closed),
        closing_price: p.closing_price ?? null,
        closing_date: p.closing_date ?? null,
        quantity: row.quantity,
        cost_price: row.cost,
        stop_price: row.stopPrice,
        current_price: p.current_price ?? null,
        effective_price: row.effectivePrice,
        invested: row.invested,
        current_value: row.currentValue,
        pnl_value: row.pnlValue,
        pnl_percent: row.pnlPercent,
        currency: p.currency ?? null,
        market_value_eur: p.valuation?.market_value ?? null,
        realized_pl_eur: p.valuation?.realized_pl ?? null,
        fx_date: p.valuation?.fx?.date ?? null,
        fx_rate_to_eur: p.valuation?.fx?.rate ?? null,
        intraday_change: p.intraday_change ?? null,
        intraday_change_pct: p.intraday_change_pct ?? null,
        intraday_abs: row.intradayAbs,
        price_10d: p.price_10d ?? null,
        security_change_10d_pct: p.change_10d_pct ?? null,
        ten_day_percent: row.tenDayPercent,
        price_1y: p.price_1y ?? null,
        security_change_1y_pct: p.change_1y_pct ?? null,
        one_year_percent: row.oneYearPercent,
        tags,
        boursorama_forum_url: p.boursorama_forum_url ?? null,
      };
    });
    downloadCsv(`aiportfolio_positions_${stamp}.csv`, rows, POSITION_COLUMNS);
  }, [positions]);

  const exportTags = useCallback(() => {
    const stamp = timestampForFilename();
    const rows = (tagSummary || []).map((row) => ({
      tag: row.tag,
      total_quantity: row.total_quantity,
      total_market_value: row.total_market_value,
      allocation_pct: totals.totalMarketValueOpen && row.total_market_value !== null
        ? (row.total_market_value / totals.totalMarketValueOpen) * 100
        : null,
      total_unrealized_pl: row.total_unrealized_pl,
      intraday_change_pct: row.intraday_change_pct,
      change_10d_pct: row.change_10d_pct,
      change_1y_pct: row.change_1y_pct,
    }));
    downloadCsv(`aiportfolio_tag_summary_${stamp}.csv`, rows, TAG_COLUMNS);
  }, [tagSummary, totals.totalMarketValueOpen]);

  const exportTotals = useCallback(() => {
    const stamp = timestampForFilename();
    const rows = [
      { metric: "total_invest_open", value: totals.totalInvestAll, coverage: totals.coverage.open_cost },
      { metric: "total_market_value_open", value: totals.totalMarketValueOpen, coverage: totals.coverage.market_value },
      { metric: "global_pl_incl_closed", value: totals.plVsInvestAll, coverage: totals.coverage.total_pl },
      { metric: "global_pl_over_total_cost_basis_pct", value: totals.plPctVsInvestAll, coverage: totals.coverage.total_pl },
      { metric: "realized_pl_closed", value: totals.realizedPlClosed, coverage: totals.coverage.realized_pl },
      { metric: "intraday_lot_pl", value: totals.intradayAbsSum, coverage: totals.coverage.intraday },
      { metric: "intraday_lot_pl_over_basis_pct", value: totals.portfolioIntradayPct, coverage: totals.coverage.intraday },
      { metric: "ten_day_lot_pl", value: totals.tenDayAbsolute, coverage: totals.coverage.ten_day },
      { metric: "ten_day_lot_pl_over_basis_pct", value: totals.tenDayPctTotal, coverage: totals.coverage.ten_day },
      { metric: "one_year_lot_pl", value: totals.oneYearAbsolute, coverage: totals.coverage.one_year },
      { metric: "one_year_lot_pl_over_basis_pct", value: totals.oneYearPctTotal, coverage: totals.coverage.one_year },
    ].map(({ coverage, ...row }) => ({ ...row, currency: "EUR", methodology: "lot_pl_over_basis",
      partial: coverage.missingLots > 0, missing_lots: coverage.missingLots, issues: coverage.issues.join("; ") }));
    downloadCsv(`aiportfolio_totals_${stamp}.csv`, rows, ["metric", "value", "currency", "methodology", "partial", "missing_lots", "issues"]);
  }, [totals]);

  const exportJson = useCallback(() => {
    const stamp = timestampForFilename();
    downloadJson(`aiportfolio_export_${stamp}.json`, {
      currency: "EUR",
      calculation_version: 2,
      methodology: "Lot P/L / basis, with dated ECB FX; excludes unrecorded cash, fees and dividends. Not an account return.",
      exported_at: new Date().toISOString(),
      totals,
      tag_summary: tagSummary,
      positions: rawPositions,
    });
  }, [rawPositions, tagSummary, totals]);

  const hasData = positions.length > 0 || tagSummary.length > 0;

  return (
    <div className="card">
      <div className="section-header">
        <h2>Export</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Download CSV files (easy import into Google Sheets) or a full JSON backup.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" className="btn secondary" onClick={exportPositions} disabled={!positions.length}>
          Download positions (CSV)
        </button>
        <button type="button" className="btn secondary" onClick={exportTags} disabled={!tagSummary.length}>
          Download tag summary (CSV)
        </button>
        <button type="button" className="btn secondary" onClick={exportTotals} disabled={!hasData}>
          Download totals (CSV)
        </button>
        <button type="button" className="btn" onClick={exportJson} disabled={!hasData}>
          Download full export (JSON)
        </button>
      </div>
    </div>
  );
}

export default ExportPanel;
