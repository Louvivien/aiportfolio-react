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
  "long_name",
  "purchase_date",
  "is_closed",
  "closing_price",
  "quantity",
  "cost_price",
  "current_price",
  "effective_price",
  "invested",
  "current_value",
  "pnl_value",
  "pnl_percent",
  "currency",
  "intraday_change",
  "intraday_change_pct",
  "intraday_abs",
  "price_10d",
  "change_10d_pct",
  "ten_day_percent",
  "price_1y",
  "change_1y_pct",
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
        long_name: p.long_name ?? "",
        purchase_date: p.purchase_date ?? p.created_at ?? "",
        is_closed: Boolean(p.is_closed),
        closing_price: p.closing_price ?? null,
        quantity: row.quantity,
        cost_price: row.cost,
        current_price: p.current_price ?? null,
        effective_price: row.effectivePrice,
        invested: row.invested,
        current_value: row.currentValue,
        pnl_value: row.pnlValue,
        pnl_percent: row.pnlPercent,
        currency: p.currency ?? null,
        intraday_change: p.intraday_change ?? null,
        intraday_change_pct: p.intraday_change_pct ?? null,
        intraday_abs: row.intradayAbs,
        price_10d: p.price_10d ?? null,
        change_10d_pct: p.change_10d_pct ?? null,
        ten_day_percent: row.tenDayPercent,
        price_1y: p.price_1y ?? null,
        change_1y_pct: p.change_1y_pct ?? null,
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
      allocation_pct: totals.totalMarketValueOpen
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
      { metric: "total_invest_open", value: totals.totalInvestAll },
      { metric: "total_market_value_open", value: totals.totalMarketValueOpen },
      { metric: "global_pl_incl_closed", value: totals.plVsInvestAll },
      { metric: "global_pl_pct", value: totals.plPctVsInvestAll },
      { metric: "realized_pl_closed", value: totals.realizedPlClosed },
      { metric: "intraday_abs_open", value: totals.intradayAbsSum },
      { metric: "intraday_pct_open", value: totals.portfolioIntradayPct },
      { metric: "ten_day_abs_open", value: totals.tenDayAbsolute },
      { metric: "ten_day_pct_open", value: totals.tenDayPctTotal },
      { metric: "one_year_abs_open", value: totals.oneYearAbsolute },
      { metric: "one_year_pct_open", value: totals.oneYearPctTotal },
    ];
    downloadCsv(`aiportfolio_totals_${stamp}.csv`, rows, ["metric", "value"]);
  }, [totals]);

  const exportJson = useCallback(() => {
    const stamp = timestampForFilename();
    downloadJson(`aiportfolio_export_${stamp}.json`, {
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
