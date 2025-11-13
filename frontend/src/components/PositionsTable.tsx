import classNames from "classnames";
import type { Position } from "../api/types";
import { colorFromScale, colorFromScaleIntraday } from "../utils/colors";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import type { PositionRow } from "../utils/portfolio";

export type SortableColumn =
  | "symbol"
  | "name"
  | "purchaseDate"
  | "quantity"
  | "cost"
  | "current"
  | "invest"
  | "value"
  | "pnl"
  | "pnlPct"
  | "intradayAbs"
  | "intradayPct"
  | "tenDayPct"
  | "tags";

export interface SortConfig {
  column: SortableColumn | null;
  direction: "asc" | "desc";
}

interface PositionsTableProps {
  rows: PositionRow[];
  pnlRange: { min: number; max: number; median: number };
  intradayRange: { min: number; max: number };
  tenDayRange: { min: number; max: number };
  sortConfig: SortConfig;
  onChangeSort: (column: SortableColumn) => void;
  onResetSort: () => void;
  showClosed: boolean;
  onToggleShowClosed: (value: boolean) => void;
  onEdit: (position: Position) => void;
  onDelete: (position: Position) => void;
  mutating?: boolean;
  deletingId?: string | null;
}

const columnMeta: { key: SortableColumn; label: string }[] = [
  { key: "symbol", label: "Symbol" },
  { key: "name", label: "Name" },
  { key: "purchaseDate", label: "Bought" },
  { key: "quantity", label: "Qty" },
  { key: "cost", label: "Cost" },
  { key: "current", label: "Current" },
  { key: "invest", label: "Invest" },
  { key: "value", label: "Value" },
  { key: "pnl", label: "P/L" },
  { key: "pnlPct", label: "P/L %" },
  { key: "intradayAbs", label: "Intraday" },
  { key: "intradayPct", label: "Intraday %" },
  { key: "tenDayPct", label: "10D %" },
  { key: "tags", label: "Tags" },
];

const comparatorMap: Record<SortableColumn, (row: PositionRow) => unknown> = {
  symbol: (row) => row.position.symbol.toUpperCase(),
  name: (row) => (row.position.long_name || "").toUpperCase(),
  purchaseDate: (row) => {
    const value = row.position.purchase_date ?? row.position.created_at ?? null;
    if (!value) {
      return null;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  },
  quantity: (row) => row.quantity,
  cost: (row) => row.cost,
  current: (row) => row.effectivePrice,
  invest: (row) => row.invested,
  value: (row) => (row.isClosed ? null : row.currentValue),
  pnl: (row) => row.pnlValue,
  pnlPct: (row) => row.pnlPercent,
  intradayAbs: (row) => row.intradayAbs,
  intradayPct: (row) => row.intradayPercent,
  tenDayPct: (row) => row.tenDayPercent,
  tags: (row) => row.position.tags.join(",").toUpperCase(),
};

const formatHeader = (label: string, active: boolean, direction: "asc" | "desc") => {
  if (!active) {
    return label;
  }
  return `${label} ${direction === "asc" ? "▲" : "▼"}`;
};

export function PositionsTable({
  rows,
  pnlRange,
  intradayRange,
  tenDayRange,
  sortConfig,
  onChangeSort,
  onResetSort,
  showClosed,
  onToggleShowClosed,
  onEdit,
  onDelete,
  mutating = false,
  deletingId = null,
}: PositionsTableProps) {
  const sortedRows = (() => {
    if (!sortConfig.column) {
      return rows;
    }
    const accessor = comparatorMap[sortConfig.column];
    const direction = sortConfig.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va === null || va === undefined) {
        return 1 * direction;
      }
      if (vb === null || vb === undefined) {
        return -1 * direction;
      }
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * direction;
      }
      const na = Number(va);
      const nb = Number(vb);
      if (Number.isNaN(na) || Number.isNaN(nb)) {
        return 0;
      }
      if (na === nb) {
        return 0;
      }
      return na > nb ? direction : -direction;
    });
  })();

  if (!rows.length) {
    return (
      <div className="card">
        <div className="section-header">
          <h2>Positions</h2>
        </div>
        <div className="empty-state">No positions yet. Add one to get started.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-header">
        <h2>Positions</h2>
        <div style={{ display: "flex", gap: 12 }}>
          {sortConfig.column && (
            <button type="button" className="btn secondary" onClick={onResetSort}>
              Reset order
            </button>
          )}
          <label
            className="checkbox-row"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
          >
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(event) => onToggleShowClosed(event.target.checked)}
            />
            Show closed positions
          </label>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              {columnMeta.map(({ key, label }) => {
                const active = sortConfig.column === key;
                return (
                  <th key={key}>
                    <button
                      type="button"
                      className="table-header-btn"
                      onClick={() => onChangeSort(key)}
                    >
                      {formatHeader(label, active, sortConfig.direction)}
                    </button>
                  </th>
                );
              })}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const { position } = row;
              const currency = position.currency || "EUR";
              const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(
                position.symbol,
              )}`;
              const closed = row.isClosed;
              const pnlStyle = colorFromScale(
                row.pnlValue,
                pnlRange.min,
                pnlRange.median,
                pnlRange.max,
              );
              const intradayStyle =
                row.intradayPercent === null
                  ? undefined
                  : colorFromScaleIntraday(
                      row.intradayPercent,
                      intradayRange.min,
                      intradayRange.max,
                    );
              const tenDayStyle =
                row.tenDayPercent === null
                  ? undefined
                  : colorFromScaleIntraday(row.tenDayPercent, tenDayRange.min, tenDayRange.max);

              return (
                <tr key={position.id ?? position.symbol}>
                  <td>
                    <a href={yahooUrl} target="_blank" rel="noreferrer" className="ticker-link">
                      {position.symbol}
                    </a>
                    {closed && <span className="badge closed">Closed</span>}
              </td>
              <td>{position.long_name || "—"}</td>
              <td>{formatDate(position.purchase_date ?? position.created_at ?? null)}</td>
              <td>{formatQuantity(row.quantity)}</td>
                  <td>{formatCurrency(row.cost, currency)}</td>
                  <td>{formatCurrency(row.effectivePrice, currency)}</td>
                  <td>{formatCurrency(row.invested, currency)}</td>
                  <td>{closed ? "—" : formatCurrency(row.currentValue, currency)}</td>
                  <td>
                    <span style={pnlStyle}>{formatCurrency(row.pnlValue, currency)}</span>
                  </td>
                  <td>{formatSignedPercent(row.pnlPercent)}</td>
                  <td
                    className={classNames({
                      "pos-green": (row.intradayAbs ?? 0) > 0,
                      "pos-red": (row.intradayAbs ?? 0) < 0,
                    })}
                  >
                    {row.intradayAbs === null
                      ? "—"
                      : formatCurrency(row.intradayAbs, currency)}
                  </td>
                  <td>
                    {row.intradayPercent === null ? (
                      "—"
                    ) : (
                      <span style={intradayStyle}>{formatNumber(row.intradayPercent)}%</span>
                    )}
                  </td>
                  <td>
                    {row.tenDayPercent === null ? (
                      "—"
                    ) : (
                      <span style={tenDayStyle}>{formatNumber(row.tenDayPercent)}%</span>
                    )}
                  </td>
                  <td>
                    {position.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onEdit(position)}
                        disabled={mutating}
                        title={`Edit ${position.symbol}`}
                        aria-label={`Edit ${position.symbol}`}
                      >
                        <span aria-hidden="true">✏️</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onDelete(position)}
                        disabled={mutating || deletingId === position.id}
                        title={`Delete ${position.symbol}`}
                        aria-label={`Delete ${position.symbol}`}
                      >
                        <span aria-hidden="true">🗑️</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PositionsTable;
