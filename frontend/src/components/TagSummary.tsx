import { useEffect, useState } from "react";
import type { TagSummaryRow } from "../api/types";
import { colorFromScaleIntraday } from "../utils/colors";
import { formatCurrency, formatNumber } from "../utils/format";

interface TagSummaryProps {
  rows: TagSummaryRow[];
  activeFilter: string | null;
  onFilter: (tag: string | null) => void;
  onOpenTimeseries: (selection: string[]) => void;
  totalMarketValueOpen: number;
}

type TagSummaryColumns = {
  marketValue: boolean;
  allocation: boolean;
  unrealizedPl: boolean;
  intradayPct: boolean;
  tenDayPct: boolean;
  oneYearPct: boolean;
  chart: boolean;
};

const TAG_SUMMARY_COLUMNS_STORAGE_KEY = "aiportfolio:tagSummaryColumns";

const DEFAULT_COLUMNS: TagSummaryColumns = {
  marketValue: true,
  allocation: true,
  unrealizedPl: true,
  intradayPct: true,
  tenDayPct: true,
  oneYearPct: true,
  chart: true,
};

const loadColumns = (): TagSummaryColumns => {
  if (typeof window === "undefined") {
    return DEFAULT_COLUMNS;
  }
  try {
    const raw = window.localStorage.getItem(TAG_SUMMARY_COLUMNS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_COLUMNS;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_COLUMNS;
    }
    return { ...DEFAULT_COLUMNS, ...parsed };
  } catch {
    return DEFAULT_COLUMNS;
  }
};

export function TagSummary({
  rows,
  activeFilter,
  onFilter,
  onOpenTimeseries,
  totalMarketValueOpen,
}: TagSummaryProps) {
  const [columns, setColumns] = useState<TagSummaryColumns>(() => loadColumns());

  useEffect(() => {
    try {
      window.localStorage.setItem(TAG_SUMMARY_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
    } catch {
      // Ignore storage failures (private mode, quotas, etc.)
    }
  }, [columns]);

  const toggleColumn = (key: keyof TagSummaryColumns) => {
    setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const intradayValues = rows
    .map((row) => row.intraday_change_pct)
    .filter((value): value is number => value !== null && value !== undefined);
  const tenDayValues = rows
    .map((row) => row.change_10d_pct)
    .filter((value): value is number => value !== null && value !== undefined);
  const oneYearValues = rows
    .map((row) => row.change_1y_pct)
    .filter((value): value is number => value !== null && value !== undefined);

  const intradayRange = {
    min: intradayValues.length ? Math.min(...intradayValues) : 0,
    max: intradayValues.length ? Math.max(...intradayValues) : 0,
  };
  const tenDayRange = {
    min: tenDayValues.length ? Math.min(...tenDayValues) : 0,
    max: tenDayValues.length ? Math.max(...tenDayValues) : 0,
  };
  const oneYearRange = {
    min: oneYearValues.length ? Math.min(...oneYearValues) : 0,
    max: oneYearValues.length ? Math.max(...oneYearValues) : 0,
  };

  return (
    <div className="card">
      <div className="section-header">
        <h2>Tag Summary</h2>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            className="icon-button"
            onClick={() => onOpenTimeseries(["Total"])}
            title="View total chart"
            aria-label="View total chart"
          >
            <span aria-hidden="true">📈</span>
          </button>
          {activeFilter && (
            <button type="button" className="btn secondary" onClick={() => onFilter(null)}>
              Clear filter
            </button>
          )}
        </div>
      </div>

      {activeFilter && (
        <div style={{ marginBottom: 16 }}>
          Filtering by <strong>{activeFilter}</strong>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">No tags available yet.</div>
      ) : (
        <>
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Columns</summary>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.marketValue}
                  onChange={() => toggleColumn("marketValue")}
                />
                Market Value
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.allocation}
                  onChange={() => toggleColumn("allocation")}
                />
                Alloc %
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.unrealizedPl}
                  onChange={() => toggleColumn("unrealizedPl")}
                />
                Unrealized P/L
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.intradayPct}
                  onChange={() => toggleColumn("intradayPct")}
                />
                Intraday %
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.tenDayPct}
                  onChange={() => toggleColumn("tenDayPct")}
                />
                10D %
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.oneYearPct}
                  onChange={() => toggleColumn("oneYearPct")}
                />
                1Y %
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={columns.chart}
                  onChange={() => toggleColumn("chart")}
                />
                Chart
              </label>
            </div>
          </details>

          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tag</th>
                  {columns.marketValue && <th>Market Value</th>}
                  {columns.allocation && <th>Alloc %</th>}
                  {columns.unrealizedPl && <th>Unrealized P/L</th>}
                  {columns.intradayPct && <th>Intraday %</th>}
                  {columns.tenDayPct && <th>10D %</th>}
                  {columns.oneYearPct && <th>1Y %</th>}
                  {columns.chart && <th>Chart</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const intradayStyle =
                    row.intraday_change_pct === null
                      ? undefined
                      : colorFromScaleIntraday(
                          row.intraday_change_pct,
                          intradayRange.min,
                          intradayRange.max,
                        );
                  const tenDayStyle =
                    row.change_10d_pct === null
                      ? undefined
                      : colorFromScaleIntraday(
                          row.change_10d_pct,
                          tenDayRange.min,
                          tenDayRange.max,
                        );
                  const oneYearStyle =
                    row.change_1y_pct === null
                      ? undefined
                      : colorFromScaleIntraday(
                          row.change_1y_pct,
                          oneYearRange.min,
                          oneYearRange.max,
                        );

                  return (
                    <tr key={row.tag}>
                      <td>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() =>
                            activeFilter === row.tag ? onFilter(null) : onFilter(row.tag)
                          }
                        >
                          {row.tag}
                        </button>
                      </td>
                      {columns.marketValue && (
                        <td>{formatCurrency(row.total_market_value, "EUR")}</td>
                      )}
                      {columns.allocation && (
                        <td>
                          {totalMarketValueOpen ? (
                            <span className="pill">
                              {formatNumber((row.total_market_value / totalMarketValueOpen) * 100)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      {columns.unrealizedPl && (
                        <td>{formatCurrency(row.total_unrealized_pl, "EUR")}</td>
                      )}
                      {columns.intradayPct && (
                        <td>
                          {row.intraday_change_pct === null ? (
                            "—"
                          ) : (
                            <span style={intradayStyle}>
                              {formatNumber(row.intraday_change_pct)}%
                            </span>
                          )}
                        </td>
                      )}
                      {columns.tenDayPct && (
                        <td>
                          {row.change_10d_pct === null ? (
                            "—"
                          ) : (
                            <span style={tenDayStyle}>{formatNumber(row.change_10d_pct)}%</span>
                          )}
                        </td>
                      )}
                      {columns.oneYearPct && (
                        <td>
                          {row.change_1y_pct === null ? (
                            "—"
                          ) : (
                            <span style={oneYearStyle}>{formatNumber(row.change_1y_pct)}%</span>
                          )}
                        </td>
                      )}
                      {columns.chart && (
                        <td>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => onOpenTimeseries([row.tag])}
                            title={`View ${row.tag} chart`}
                            aria-label={`View chart for ${row.tag}`}
                          >
                            <span aria-hidden="true">📈</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default TagSummary;
