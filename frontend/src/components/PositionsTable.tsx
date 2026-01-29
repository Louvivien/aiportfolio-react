import { useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import type { ForumPost, Position } from "../api/types";
import { fetchForumPostsForPosition } from "../api/client";
import { colorFromScale, colorFromScaleIntraday } from "../utils/colors";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import { buildBoursoramaForumUrl } from "../utils/forums";
import { evaluateStockIndicator } from "../utils/indicator";
import type { IndicatorStep, StockIndicatorResult } from "../utils/indicator";
import type { PositionRow } from "../utils/portfolio";

type ForumPreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; posts: ForumPost[] };

type ForumPreviewMap = Record<string, ForumPreviewState>;

const describeForumError = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error && error.message) {
    return String(error.message);
  }
  return "Impossible de charger les messages.";
};

type PositionsColumns = {
  symbol: boolean;
  name: boolean;
  purchaseDate: boolean;
  quantity: boolean;
  cost: boolean;
  current: boolean;
  invest: boolean;
  value: boolean;
  pnl: boolean;
  pnlPct: boolean;
  intradayAbs: boolean;
  intradayPct: boolean;
  tenDayPct: boolean;
  oneYearPct: boolean;
  indicator: boolean;
  tags: boolean;
  actions: boolean;
};

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
  | "oneYearPct"
  | "indicator"
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
  oneYearRange: { min: number; max: number };
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

const POSITIONS_COLUMNS_STORAGE_KEY = "aiportfolio:positionsColumns";

const DEFAULT_COLUMNS: PositionsColumns = {
  symbol: true,
  name: true,
  purchaseDate: true,
  quantity: true,
  cost: true,
  current: true,
  invest: true,
  value: true,
  pnl: true,
  pnlPct: true,
  intradayAbs: true,
  intradayPct: true,
  tenDayPct: true,
  oneYearPct: true,
  indicator: true,
  tags: true,
  actions: true,
};

const loadColumns = (): PositionsColumns => {
  if (typeof window === "undefined") {
    return DEFAULT_COLUMNS;
  }
  try {
    const raw = window.localStorage.getItem(POSITIONS_COLUMNS_STORAGE_KEY);
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
  { key: "oneYearPct", label: "1Y %" },
  { key: "indicator", label: "Indicator" },
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
  oneYearPct: (row) => row.oneYearPercent,
  indicator: (row) => {
    const result = evaluateStockIndicator(row.position);
    if (result.disabled || !result.outcome) {
      return null;
    }
    return result.outcome.id;
  },
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
  oneYearRange,
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
  const [forumPreviewMap, setForumPreviewMap] = useState<ForumPreviewMap>({});
  const [activeForumId, setActiveForumId] = useState<string | null>(null);
  const hideForumTimerRef = useRef<number | null>(null);
  const [columns, setColumns] = useState<PositionsColumns>(() => loadColumns());
  const [indicatorDetail, setIndicatorDetail] = useState<{
    position: Position;
    indicator: StockIndicatorResult;
  } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(POSITIONS_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
    } catch {
      // Ignore storage failures (private mode, quotas, etc.)
    }
  }, [columns]);

  const toggleColumn = (key: keyof PositionsColumns) => {
    setColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (sortConfig.column === key && prev[key]) {
        onResetSort();
      }
      return next;
    });
  };

  const openIndicatorModal = useCallback((position: Position) => {
    const indicator = evaluateStockIndicator(position);
    setIndicatorDetail({ position, indicator });
  }, []);

  const closeIndicatorModal = useCallback(() => setIndicatorDetail(null), []);

  const clearHideTimer = useCallback(() => {
    if (hideForumTimerRef.current !== null) {
      window.clearTimeout(hideForumTimerRef.current);
      hideForumTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  const handleForumMouseEnter = useCallback(
    (position: Position) => {
      if (!position.id) {
        return;
      }
      const id = position.id;
      clearHideTimer();
      setActiveForumId(id);
      setForumPreviewMap((prev) => {
        const current = prev[id];
        if (!current || current.status === "error") {
          return { ...prev, [id]: { status: "loading" } };
        }
        return prev;
      });
      const current = forumPreviewMap[id];
      if (current && current.status !== "error") {
        return;
      }
      fetchForumPostsForPosition(id)
        .then((data) => {
          setForumPreviewMap((prev) => ({
            ...prev,
            [id]: { status: "success", posts: data.posts || [] },
          }));
        })
        .catch((error) => {
          setForumPreviewMap((prev) => ({
            ...prev,
            [id]: { status: "error", message: describeForumError(error) },
          }));
        });
    },
    [clearHideTimer, forumPreviewMap],
  );

  const handleForumMouseLeave = useCallback(
    (positionId?: string | null) => {
      const targetId = positionId ?? null;
      clearHideTimer();
      hideForumTimerRef.current = window.setTimeout(() => {
        setActiveForumId((current) => (targetId === null || current === targetId ? null : current));
        hideForumTimerRef.current = null;
      }, 200);
    },
    [clearHideTimer],
  );

  const renderForumPreview = (state?: ForumPreviewState) => {
    if (!state || state.status === "loading") {
      return <div className="forum-popover-status">Chargement…</div>;
    }
    if (state.status === "error") {
      return <div className="forum-popover-status forum-popover-status--error">{state.message}</div>;
    }
    if (!state.posts.length) {
      return <div className="forum-popover-status">Aucune discussion récente.</div>;
    }
    return (
      <>
        <div className="forum-popover-head">
          <span>Sujet</span>
          <span>Dernière réponse</span>
          <span>J'aime</span>
          <span>Messages</span>
        </div>
        {state.posts.map((post, index) => {
          const key = post.topic_url ?? `${post.title}-${index}`;
          return (
            <div className="forum-popover-row" key={key}>
              <div className="forum-popover-col forum-popover-title">
                {post.topic_url ? (
                  <a href={post.topic_url} target="_blank" rel="noreferrer">
                    {post.title}
                  </a>
                ) : (
                  <span>{post.title}</span>
                )}
                {post.created_at ? <div className="forum-popover-meta">{post.created_at}</div> : null}
              </div>
              <div className="forum-popover-col forum-popover-last">
                {post.last_reply_at ? <div>{post.last_reply_at}</div> : <div>—</div>}
              </div>
              <div className="forum-popover-col forum-popover-number">{post.likes ?? "—"}</div>
              <div className="forum-popover-col forum-popover-number">{post.messages ?? "—"}</div>
            </div>
          );
        })}
      </>
    );
  };
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

  const indicatorModal = indicatorDetail ? (
    <IndicatorModal detail={indicatorDetail} onClose={closeIndicatorModal} />
  ) : null;

  if (!rows.length) {
    return (
      <>
        <div className="card">
          <div className="section-header">
            <h2>Positions</h2>
          </div>
          <div className="empty-state">No positions yet. Add one to get started.</div>
        </div>
        {indicatorModal}
      </>
    );
  }

  return (
    <>
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
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Columns</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
            {columnMeta.map(({ key, label }) => (
              <label className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  checked={columns[key]}
                  onChange={() => toggleColumn(key)}
                />
                {label}
              </label>
            ))}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={columns.actions}
                onChange={() => toggleColumn("actions")}
              />
              Actions
            </label>
          </div>
        </details>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                {columnMeta
                  .filter(({ key }) => columns[key])
                  .map(({ key, label }) => {
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
                {columns.actions && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const { position } = row;
                const currency = position.currency || "EUR";
                const tags = Array.isArray(position.tags) ? position.tags : [];
                const symbolUpper = position.symbol.toUpperCase();
                const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(symbolUpper)}`;
                const isEtf = tags.some((tag) => tag && tag.toUpperCase() === "ETF");
                const boursoramaUrl =
                  position.boursorama_forum_url || buildBoursoramaForumUrl(position.symbol);
                const showForumLink = Boolean(boursoramaUrl) && !isEtf;
                const forumPreviewState = position.id ? forumPreviewMap[position.id] : undefined;
                const isForumActive = activeForumId === position.id;
                const forumHandlers =
                  showForumLink && position.id
                    ? {
                        onMouseEnter: () => handleForumMouseEnter(position),
                        onMouseLeave: () => handleForumMouseLeave(position.id),
                        onFocus: () => handleForumMouseEnter(position),
                        onBlur: () => handleForumMouseLeave(position.id),
                      }
                    : undefined;
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
                const oneYearStyle =
                  row.oneYearPercent === null
                    ? undefined
                    : colorFromScaleIntraday(
                        row.oneYearPercent,
                        oneYearRange.min,
                        oneYearRange.max,
                      );
                const indicator = evaluateStockIndicator(position);

                return (
                  <tr key={position.id ?? position.symbol}>
                    {columns.symbol && (
                      <td>
                        <a href={yahooUrl} target="_blank" rel="noreferrer" className="ticker-link">
                          {position.symbol}
                        </a>
                        {showForumLink && (
                          <div className="forum-link-wrapper" {...(forumHandlers ?? {})}>
                            <a
                              href={boursoramaUrl!}
                              target="_blank"
                              rel="noreferrer"
                              className="ticker-link forum-link-label"
                            >
                              forum
                            </a>
                            {isForumActive && position.id && (
                              <div
                                className="forum-popover"
                                onMouseEnter={() => handleForumMouseEnter(position)}
                                onMouseLeave={() => handleForumMouseLeave(position.id)}
                              >
                                {renderForumPreview(forumPreviewState)}
                              </div>
                            )}
                          </div>
                        )}
                        {closed && <span className="badge closed">Closed</span>}
                      </td>
                    )}
                    {columns.name && <td>{position.long_name || "—"}</td>}
                    {columns.purchaseDate && (
                      <td>{formatDate(position.purchase_date ?? position.created_at ?? null)}</td>
                    )}
                    {columns.quantity && <td>{formatQuantity(row.quantity)}</td>}
                    {columns.cost && <td>{formatCurrency(row.cost, currency)}</td>}
                    {columns.current && <td>{formatCurrency(row.effectivePrice, currency)}</td>}
                    {columns.invest && <td>{formatCurrency(row.invested, currency)}</td>}
                    {columns.value && (
                      <td>{closed ? "—" : formatCurrency(row.currentValue, currency)}</td>
                    )}
                    {columns.pnl && (
                      <td>
                        <span style={pnlStyle}>{formatCurrency(row.pnlValue, currency)}</span>
                      </td>
                    )}
                    {columns.pnlPct && <td>{formatSignedPercent(row.pnlPercent)}</td>}
                    {columns.intradayAbs && (
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
                    )}
                    {columns.intradayPct && (
                      <td>
                        {row.intradayPercent === null ? (
                          "—"
                        ) : (
                          <span style={intradayStyle}>{formatNumber(row.intradayPercent)}%</span>
                        )}
                      </td>
                    )}
                    {columns.tenDayPct && (
                      <td>
                        {row.tenDayPercent === null ? (
                          "—"
                        ) : (
                          <span style={tenDayStyle}>{formatNumber(row.tenDayPercent)}%</span>
                        )}
                      </td>
                    )}
                    {columns.oneYearPct && (
                      <td>
                        {row.oneYearPercent === null ? (
                          "—"
                        ) : (
                          <span style={oneYearStyle}>{formatNumber(row.oneYearPercent)}%</span>
                        )}
                      </td>
                    )}
                    {columns.indicator && (
                      <td>
                        <button
                          type="button"
                          className="indicator-pill-btn"
                          onClick={() => openIndicatorModal(position)}
                          title="Open fundamentals indicator"
                        >
                          <span
                            className={classNames("indicator-pill", {
                              "indicator-pill--positive": indicator.outcome?.tone === "positive",
                              "indicator-pill--warning":
                                indicator.outcome?.tone === "warning" ||
                                (!indicator.outcome && indicator.missingInputs.length > 0),
                              "indicator-pill--negative": indicator.outcome?.tone === "negative",
                              "indicator-pill--neutral":
                                indicator.outcome?.tone === "neutral" ||
                                (!indicator.outcome && !indicator.missingInputs.length) ||
                                indicator.disabled,
                            })}
                          >
                            <span className="indicator-pill-code">
                              {indicator.outcome ? indicator.outcome.id : indicator.disabled ? "—" : "…"}
                            </span>
                            <span className="indicator-pill-label">
                              {indicator.disabled
                                ? "Indicator disabled"
                                : indicator.outcome
                                ? indicator.outcome.label
                                : indicator.missingInputs.length
                                  ? "Data needed"
                                  : "Not rated"}
                            </span>
                          </span>
                        </button>
                        {indicator.missingInputs.length > 0 && !indicator.disabled && (
                          <div className="indicator-hint">
                            Missing: {indicator.missingInputs.join(", ")}
                          </div>
                        )}
                        {indicator.disabled && (
                          <div className="indicator-hint">Disabled for this position</div>
                        )}
                      </td>
                    )}
                    {columns.tags && (
                      <td>
                        {position.tags.map((tag) => (
                          <span key={tag} className="tag-chip">
                            {tag}
                          </span>
                        ))}
                      </td>
                    )}
                    {columns.actions && (
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
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {indicatorModal}
    </>
  );
}

interface IndicatorModalProps {
  detail: { position: Position; indicator: StockIndicatorResult };
  onClose: () => void;
}

function IndicatorModal({ detail, onClose }: IndicatorModalProps) {
  const { position, indicator } = detail;

  const pillToneClass = classNames({
    "indicator-pill--positive": indicator.outcome?.tone === "positive",
    "indicator-pill--warning":
      indicator.outcome?.tone === "warning" ||
      (!indicator.outcome && indicator.missingInputs.length > 0),
    "indicator-pill--negative": indicator.outcome?.tone === "negative",
    "indicator-pill--neutral":
      indicator.outcome?.tone === "neutral" ||
      (!indicator.outcome && !indicator.missingInputs.length) ||
      indicator.disabled,
  });

  const formatStepValue = (step: IndicatorStep): string => {
    if (step.value === null) {
      return "—";
    }
    const isPercent = step.id === "revenueGrowth" || step.id === "roeAvg";
    return isPercent ? `${formatNumber(step.value)}%` : formatNumber(step.value);
  };

  const describeStatus = (step: IndicatorStep): string => {
    switch (step.status) {
      case "pass":
        return "Pass";
      case "fail":
        return step.failOutcome ? `Fails → ${step.failOutcome.label}` : "Fails rule";
      case "missing":
        return "Missing input";
      case "skipped":
        return "Not evaluated (blocked earlier)";
      default:
        return "";
    }
  };

  const headline =
    indicator.disabled || !indicator.outcome
      ? indicator.disabled
        ? "Indicator disabled"
        : indicator.missingInputs.length
          ? "Data needed"
          : "Not rated"
      : `${indicator.outcome.id} • ${indicator.outcome.label}`;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal modal-wide">
        <div className="section-header">
          <div>
            <div
              className="muted"
              style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}
            >
              Fundamentals indicator
            </div>
            <h3 style={{ margin: "4px 0 0" }}>
              {position.symbol}
              {position.long_name ? ` — ${position.long_name}` : ""}
            </h3>
          </div>
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="indicator-modal-summary">
          <span className={classNames("indicator-pill", pillToneClass)}>
            <span className="indicator-pill-code">
              {indicator.outcome ? indicator.outcome.id : indicator.disabled ? "—" : "…"}
            </span>
            <span className="indicator-pill-label">{headline}</span>
          </span>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {indicator.disabled
              ? "Indicator disabled for this holding — enable it in the edit form to compute a score."
              : indicator.outcome
                ? "All inputs provided. Outcome follows the five-step decision tree below."
                : indicator.missingInputs.length
                  ? `Add the missing inputs to compute the indicator: ${indicator.missingInputs.join(", ")}.`
                  : "Add indicator inputs to compute a score for this holding."}
          </p>
        </div>
        <div className="indicator-steps">
          {indicator.steps.map((step) => (
            <div key={step.id} className={classNames("indicator-step", `indicator-step--${step.status}`)}>
              <div className="indicator-step-head">
                <div>
                  <div className="indicator-step-label">{step.label}</div>
                  <div className="indicator-step-condition">{step.condition}</div>
                </div>
                <div className="indicator-step-value">{formatStepValue(step)}</div>
              </div>
              <div className="indicator-step-status">
                {describeStatus(step)}
                {step.status === "fail" && step.failOutcome ? (
                  <span className="indicator-step-outcome">
                    → {step.failOutcome.id}. {step.failOutcome.label}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default PositionsTable;
