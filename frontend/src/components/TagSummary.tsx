import type { TagSummaryRow } from "../api/types";
import { colorFromScaleIntraday } from "../utils/colors";
import { formatCurrency, formatNumber } from "../utils/format";

interface TagSummaryProps {
  rows: TagSummaryRow[];
  activeFilter: string | null;
  onFilter: (tag: string | null) => void;
  onOpenTimeseries: (selection: string[]) => void;
}

export function TagSummary({ rows, activeFilter, onFilter, onOpenTimeseries }: TagSummaryProps) {
  const intradayValues = rows
    .map((row) => row.intraday_change_pct)
    .filter((value): value is number => value !== null && value !== undefined);
  const tenDayValues = rows
    .map((row) => row.change_10d_pct)
    .filter((value): value is number => value !== null && value !== undefined);

  const intradayRange = {
    min: intradayValues.length ? Math.min(...intradayValues) : 0,
    max: intradayValues.length ? Math.max(...intradayValues) : 0,
  };
  const tenDayRange = {
    min: tenDayValues.length ? Math.min(...tenDayValues) : 0,
    max: tenDayValues.length ? Math.max(...tenDayValues) : 0,
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
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Market Value</th>
                <th>Unrealized P/L</th>
                <th>Intraday %</th>
                <th>10D %</th>
                <th>Chart</th>
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
                    <td>{formatCurrency(row.total_market_value, "EUR")}</td>
                    <td>{formatCurrency(row.total_unrealized_pl, "EUR")}</td>
                    <td>
                      {row.intraday_change_pct === null ? (
                        "—"
                      ) : (
                        <span style={intradayStyle}>{formatNumber(row.intraday_change_pct)}%</span>
                      )}
                    </td>
                    <td>
                      {row.change_10d_pct === null ? (
                        "—"
                      ) : (
                        <span style={tenDayStyle}>{formatNumber(row.change_10d_pct)}%</span>
                      )}
                    </td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TagSummary;
