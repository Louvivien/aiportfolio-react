import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchMonthlyReport,
  fetchMonthlyReports,
  regenerateMonthlyReport,
} from "../api/client";
import type {
  MonthlyPerformanceReport,
  MonthlyReportListItem,
  MonthlyReportPositionRow,
  MonthlyReportTagRow,
} from "../api/types";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
  formatSignedPercent,
} from "../utils/format";
import { colorFromScale, colorFromScaleIntraday } from "../utils/colors";

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeAxios = error as { response?: { data?: { detail?: string } }; message?: string };
    if (typeof maybeAxios.response?.data?.detail === "string") {
      return maybeAxios.response.data.detail;
    }
    if (typeof maybeAxios.message === "string") {
      return maybeAxios.message;
    }
  }
  return "Monthly report unavailable.";
};

const formatMonth = (month: string): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) {
    return month;
  }
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const signedCurrency = (
  value: number | null | undefined,
  currency: string | null | undefined = null,
): string => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value >= 0 ? "+" : ""}${formatCurrency(value, currency)}`;
};

const valueClass = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
    return "";
  }
  return value > 0 ? "pos-green" : "pos-red";
};

const formatBasis = (value: string | null | undefined): string => {
  switch (value) {
    case "cost":
      return "purchase price";
    case "closing":
      return "closing price";
    case "market":
      return "market price";
    case "mixed":
      return "mixed";
    default:
      return "";
  }
};

const securityName = (row: { name?: string | null; symbol?: string | null }): string => {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const symbol = typeof row.symbol === "string" ? row.symbol.trim() : "";
  return name || symbol || "Position";
};

const rowCurrency = (row: { currency?: string | null }): string => row.currency || "EUR";

const formatHeader = (label: string, active: boolean, direction: "asc" | "desc") => {
  if (!active) {
    return label;
  }
  return `${label} ${direction === "asc" ? "▲" : "▼"}`;
};

const median = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
};

const finiteNumbers = (values: Array<number | null | undefined>): number[] =>
  values.filter((value): value is number => Number.isFinite(value));

const valueRange = (values: Array<number | null | undefined>) => {
  const nums = finiteNumbers(values);
  return {
    min: nums.length ? Math.min(...nums) : 0,
    median: median(nums),
    max: nums.length ? Math.max(...nums) : 0,
  };
};

const percentRange = (values: Array<number | null | undefined>) => {
  const nums = finiteNumbers(values);
  return {
    min: nums.length ? Math.min(...nums) : 0,
    max: nums.length ? Math.max(...nums) : 0,
  };
};

function ReportMetric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="monthly-report-metric">
      <span>{label}</span>
      <strong className={className}>{value}</strong>
    </div>
  );
}

function TagRows({ rows }: { rows: MonthlyReportTagRow[] }) {
  const performanceValueRange = useMemo(
    () => valueRange(rows.map((row) => row.performance_value)),
    [rows],
  );
  const performancePctRange = useMemo(
    () => percentRange(rows.map((row) => row.performance_pct)),
    [rows],
  );

  if (!rows.length) {
    return <div className="empty-state">No tag performance for this report.</div>;
  }

  return (
    <div className="table-scroll">
      <table className="table monthly-report-table">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Opening value + purchases</th>
            <th>Closing value + sales</th>
            <th>P/L</th>
            <th>P/L / basis</th>
            <th>Positions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tag}>
              <td>
                <span className="tag-chip">{row.tag}{row.incomplete ? " (Partial)" : ""}</span>
              </td>
              <td>{formatCurrency(row.start_value, "EUR")}</td>
              <td>{formatCurrency(row.end_value, "EUR")}</td>
              <td>
                <span
                  style={colorFromScale(
                    row.performance_value,
                    performanceValueRange.min,
                    performanceValueRange.median,
                    performanceValueRange.max,
                  )}
                >
                  {signedCurrency(row.performance_value, "EUR")}
                </span>
              </td>
              <td>
                <span
                  style={colorFromScaleIntraday(
                    row.performance_pct,
                    performancePctRange.min,
                    performancePctRange.max,
                  )}
                >
                  {formatSignedPercent(row.performance_pct)}
                </span>
              </td>
              <td>{row.positions_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MonthlyPositionSortColumn =
  | "position"
  | "tags"
  | "quantity"
  | "start"
  | "end"
  | "startValue"
  | "endValue"
  | "pnl"
  | "return";

interface MonthlyPositionSortConfig {
  column: MonthlyPositionSortColumn;
  direction: "asc" | "desc";
}

const monthlyPositionColumns: { key: MonthlyPositionSortColumn; label: string }[] = [
  { key: "position", label: "Position" },
  { key: "tags", label: "Tags" },
  { key: "quantity", label: "Qty" },
  { key: "start", label: "Start" },
  { key: "end", label: "End" },
  { key: "startValue", label: "Opening value + purchases" },
  { key: "endValue", label: "Closing value + sales" },
  { key: "pnl", label: "P/L" },
  { key: "return", label: "P/L / basis" },
];

const toTime = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

const sortValue = (
  row: MonthlyReportPositionRow,
  column: MonthlyPositionSortColumn,
): string | number | null => {
  switch (column) {
    case "position":
      return securityName(row).toUpperCase();
    case "tags":
      return row.tags.join(",").toUpperCase();
    case "quantity":
      return row.quantity;
    case "start":
      return toTime(row.start_date);
    case "end":
      return toTime(row.end_date);
    case "startValue":
      return row.start_value;
    case "endValue":
      return row.end_value;
    case "pnl":
      return row.performance_value;
    case "return":
      return row.performance_pct;
    default:
      return null;
  }
};

const compareSortValues = (
  left: string | number | null,
  right: string | number | null,
  direction: "asc" | "desc",
): number => {
  const leftMissing = left === null || left === undefined || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || Number.isNaN(right);
  if (leftMissing !== rightMissing) {
    return leftMissing ? 1 : -1;
  }
  if (leftMissing && rightMissing) {
    return 0;
  }

  let result = 0;
  if (typeof left === "number" && typeof right === "number") {
    result = left - right;
  } else {
    result = String(left).localeCompare(String(right));
  }
  return direction === "asc" ? result : -result;
};

function PositionRows({ rows }: { rows: MonthlyReportPositionRow[] }) {
  const [sortConfig, setSortConfig] = useState<MonthlyPositionSortConfig>({
    column: "return",
    direction: "desc",
  });
  const performanceValueRange = useMemo(
    () => valueRange(rows.map((row) => row.performance_value)),
    [rows],
  );
  const performancePctRange = useMemo(
    () => percentRange(rows.map((row) => row.performance_pct)),
    [rows],
  );
  const sortedRows = useMemo(
    () =>
      [...rows].sort((left, right) =>
        compareSortValues(
          sortValue(left, sortConfig.column),
          sortValue(right, sortConfig.column),
          sortConfig.direction,
        ),
      ),
    [rows, sortConfig],
  );

  const changeSort = (column: MonthlyPositionSortColumn) => {
    setSortConfig((current) =>
      current.column === column
        ? {
            column,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { column, direction: "asc" },
    );
  };

  if (!rows.length) {
    return <div className="empty-state">No position performance for this report.</div>;
  }

  return (
    <div className="table-scroll">
      <table className="table monthly-report-table">
        <thead>
          <tr>
            {monthlyPositionColumns.map(({ key, label }) => {
              const active = sortConfig.column === key;
              return (
                <th key={key}>
                  <button
                    type="button"
                    className="table-header-btn"
                    onClick={() => changeSort(key)}
                  >
                    {formatHeader(label, active, sortConfig.direction)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.position_id ?? row.symbol}>
              <td>
                <strong>{securityName(row)}{row.incomplete ? " (Partial)" : ""}</strong>
                {row.notes.length > 0 && (
                  <div className="monthly-report-note">{row.notes.join(" ")}</div>
                )}
              </td>
              <td>
                {row.tags.length ? (
                  row.tags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>{formatQuantity(row.quantity)}</td>
              <td>
                <strong>{formatDate(row.start_date)}</strong>
                <div className="muted">
                  {formatCurrency(row.start_price, rowCurrency(row))} {formatBasis(row.start_basis)}
                </div>
              </td>
              <td>
                <strong>{formatDate(row.end_date)}</strong>
                <div className="muted">
                  {formatCurrency(row.end_price, rowCurrency(row))} {formatBasis(row.end_basis)}
                </div>
              </td>
              <td>{formatCurrency(row.start_value, rowCurrency(row))}</td>
              <td>{formatCurrency(row.end_value, rowCurrency(row))}</td>
              <td>
                <span
                  style={colorFromScale(
                    row.performance_value,
                    performanceValueRange.min,
                    performanceValueRange.median,
                    performanceValueRange.max,
                  )}
                >
                  {signedCurrency(row.performance_value, rowCurrency(row))}
                </span>
              </td>
              <td>
                <span
                  style={colorFromScaleIntraday(
                    row.performance_pct,
                    performancePctRange.min,
                    performancePctRange.max,
                  )}
                >
                  {formatSignedPercent(row.performance_pct)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MonthlyPositionChartMetric = "value" | "percent";

interface MonthlyPositionChartDatum {
  key: string;
  name: string;
  label: string;
  performanceValue: number | null;
  performancePct: number | null;
  chartValue: number;
  currency: string | null | undefined;
}

const POSITIVE = "#34a853";
const NEGATIVE = "#d93025";

function buildMonthlyPositionChartData(
  rows: MonthlyReportPositionRow[],
  metric: MonthlyPositionChartMetric,
): MonthlyPositionChartDatum[] {
  return rows
    .map((row) => {
      const performanceValue = Number.isFinite(row.performance_value) ? row.performance_value : null;
      const performancePct =
        row.performance_pct !== null && Number.isFinite(row.performance_pct)
          ? row.performance_pct
          : null;
      const metricValue = metric === "percent" ? performancePct : performanceValue;
      return {
        key: row.position_id ?? row.symbol,
        name: securityName(row),
        label: securityName(row),
        performanceValue,
        performancePct,
        chartValue: metricValue === null || Number.isNaN(metricValue) ? 0 : metricValue,
        currency: rowCurrency(row),
      };
    })
    .sort((a, b) => a.chartValue - b.chartValue);
}

function MonthlyPositionChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: MonthlyPositionChartDatum }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const datum = payload[0].payload;
  return (
    <div className="monthly-chart-tooltip">
      <strong>{datum.name}</strong>
      <span className={valueClass(datum.performanceValue)}>
        P/L: {signedCurrency(datum.performanceValue, datum.currency)}
      </span>
      <span className="muted">
        P/L / basis: {formatSignedPercent(datum.performancePct)}
      </span>
    </div>
  );
}

function MonthlyPositionsPerformanceChart({ rows }: { rows: MonthlyReportPositionRow[] }) {
  const [metric, setMetric] = useState<MonthlyPositionChartMetric>("value");
  const data = useMemo(() => buildMonthlyPositionChartData(rows, metric), [metric, rows]);
  const height = useMemo(() => Math.min(900, Math.max(260, 120 + data.length * 26)), [data.length]);
  const currencyHint = useMemo(
    () => data.find((entry) => entry.currency)?.currency ?? "EUR",
    [data],
  );

  if (!data.length) {
    return <div className="empty-state">No monthly position performance available yet.</div>;
  }

  return (
    <>
      <div className="monthly-chart-actions">
        <button
          type="button"
          className={metric === "value" ? "btn" : "btn secondary"}
          onClick={() => setMetric("value")}
          aria-pressed={metric === "value"}
        >
          Value
        </button>
        <button
          type="button"
          className={metric === "percent" ? "btn" : "btn secondary"}
          onClick={() => setMetric("percent")}
          aria-pressed={metric === "percent"}
        >
          %
        </button>
      </div>
      <div className="monthly-chart" style={{ height }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 10, right: 18, bottom: 10, left: 18 }}
          >
          <ReferenceLine x={0} stroke="#e5e7eb" />
          <XAxis
            type="number"
            tickFormatter={(value) =>
              metric === "percent"
                ? formatSignedPercent(Number(value), 1)
                : formatCurrency(Number(value), currencyHint)
            }
            tick={{ fontSize: 12, fill: "#6b7280" }}
            axisLine={{ stroke: "#e5e7eb" }}
            tickLine={{ stroke: "#e5e7eb" }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={190}
            tick={{ fontSize: 12, fill: "#111827" }}
            axisLine={{ stroke: "#e5e7eb" }}
            tickLine={{ stroke: "#e5e7eb" }}
          />
          <Tooltip
            content={<MonthlyPositionChartTooltip />}
            cursor={{ fill: "rgba(229, 231, 235, 0.55)" }}
          />
          <Bar dataKey="chartValue" barSize={14} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell
                key={entry.key}
                fill={entry.chartValue >= 0 ? POSITIVE : NEGATIVE}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </>
  );
}

export function MonthlyReportsPanel() {
  const [reports, setReports] = useState<MonthlyReportListItem[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [report, setReport] = useState<MonthlyPerformanceReport | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copyingReport, setCopyingReport] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportRequest = useRef(0);
  const reportExportRef = useRef<HTMLDivElement | null>(null);

  const selectedListItem = useMemo(
    () => reports.find((item) => item.month === selectedMonth) ?? null,
    [reports, selectedMonth],
  );

  const loadList = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const response = await fetchMonthlyReports();
      setReports(response.reports || []);
      setSelectedMonth((current) => current || response.reports?.[0]?.month || "");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadReport = useCallback(async (month: string) => {
    const request = ++reportRequest.current;
    setReport(null);
    if (!month) { setReportLoading(false); return; }
    setReportLoading(true);
    setError(null);
    try {
      const next = await fetchMonthlyReport(month);
      if (request === reportRequest.current) setReport(next);
    } catch (err) {
      if (request === reportRequest.current) setError(extractErrorMessage(err));
    } finally {
      if (request === reportRequest.current) setReportLoading(false);
    }
  }, []);

  const handleRegenerate = useCallback(async () => {
    if (!selectedMonth) {
      return;
    }
    setRegenerating(true);
    setError(null);
    try {
      const nextReport = await regenerateMonthlyReport(selectedMonth);
      setReport(nextReport);
      await loadList();
      setSelectedMonth(nextReport.month);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRegenerating(false);
    }
  }, [loadList, selectedMonth]);

  const handleCopyPng = useCallback(async () => {
    const node = reportExportRef.current;
    if (!node) {
      return;
    }
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      setError("PNG clipboard export is not supported by this browser.");
      return;
    }

    setCopyingReport(true);
    setCopySuccess(null);
    setError(null);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) {
            resolve(nextBlob);
          } else {
            reject(new Error("Could not create report PNG."));
          }
        }, "image/png");
      });
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
        }),
      ]);
      setCopySuccess("PNG copied to clipboard.");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setCopyingReport(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    loadReport(selectedMonth);
    return () => { reportRequest.current += 1; };
  }, [loadReport, selectedMonth]);

  const activeReport = report ?? selectedListItem;
  const summary = report?.summary ? { ...report.summary,
    ...(report.summary.incomplete ? report.summary.coverage : {}) } : null;
  const reportPositions = report?.positions.map((row) => row.incomplete && row.coverage ? { ...row, ...row.coverage } : row) ?? [];
  const reportTags = report?.tags.map((row) => row.incomplete && row.coverage ? { ...row, ...row.coverage } : row) ?? [];
  const missingPositions = report?.skipped_positions.filter((row) => row.incomplete) ?? [];

  return (
    <details className="card monthly-report-card">
      <summary className="monthly-report-toggle">Monthly reports</summary>
      <div ref={reportExportRef} className="monthly-report-export-surface">
      <div className="section-header monthly-report-header">
        <div>
          <h2>Monthly Reports</h2>
          {activeReport && (
            <p className="muted">
              {formatMonth(activeReport.month)} · {formatDate(activeReport.period_start)} to{" "}
              {formatDate(activeReport.period_end)}
            </p>
          )}
        </div>
        <div className="monthly-report-actions" data-html2canvas-ignore="true">
          <select
            aria-label="Monthly report"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            disabled={listLoading || regenerating || !reports.length}
          >
            {reports.map((item) => (
              <option key={item.month} value={item.month}>
                {formatMonth(item.month)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn secondary"
            onClick={handleCopyPng}
            disabled={!report || reportLoading || listLoading || copyingReport}
          >
            {copyingReport ? "Copying…" : "Copy PNG"}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={handleRegenerate}
            disabled={!selectedMonth || reportLoading || regenerating}
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-text" data-html2canvas-ignore="true">
          {error}
        </div>
      )}
      {copySuccess && (
        <div className="monthly-copy-success" data-html2canvas-ignore="true">
          {copySuccess}
        </div>
      )}

      {listLoading ? (
        <div className="loading">Loading monthly reports…</div>
      ) : error && !report && !reportLoading ? (
        <div className="empty-state">
          <p>Report could not be loaded.</p>
          <button type="button" className="btn secondary" onClick={() => selectedMonth ? loadReport(selectedMonth) : loadList()}>Retry</button>
        </div>
      ) : !reports.length ? (
        <div className="empty-state">No monthly report available yet.</div>
      ) : reportLoading || !report || !summary ? (
        <div className="loading">Loading report…</div>
      ) : (
        <>
          {summary.incomplete && <div role="status">
            <p>Partial report: figures include records with available prices and dates.</p>
            <ul>{missingPositions.map((row) => <li key={row.position_id ?? row.symbol}>{row.symbol}: {row.reason}</li>)}</ul>
          </div>}
          <div className="monthly-report-meta">
            <span>Generated {formatDate(report.generated_at)}</span>
            <span>{summary.positions_count} positions included</span>
            {summary.positions_skipped > 0 && (
              <span>{summary.positions_skipped} positions skipped</span>
            )}
          </div>

          <div className="monthly-report-metrics">
            <ReportMetric label="Opening value + purchases" value={formatCurrency(summary.start_value, "EUR")} />
            <ReportMetric label="Closing value + sales" value={formatCurrency(summary.end_value, "EUR")} />
            <ReportMetric
              label={summary.incomplete ? "Performance (Partial)" : "Performance"}
              value={signedCurrency(summary.performance_value, "EUR")}
              className={valueClass(summary.performance_value)}
            />
            <ReportMetric
              label={summary.incomplete ? "P/L / basis (Partial)" : "P/L / basis"}
              value={formatSignedPercent(summary.performance_pct)}
              className={valueClass(summary.performance_pct)}
            />
          </div>

          <div className="monthly-report-section">
            <h3>Performance by tag</h3>
            <TagRows rows={reportTags} />
          </div>

          <div className="monthly-report-section">
            <h3>Performance by position</h3>
            <PositionRows rows={reportPositions} />
          </div>

          <div className="monthly-report-section">
            <h3>Monthly performance by position</h3>
            <MonthlyPositionsPerformanceChart rows={reportPositions} />
          </div>
        </>
      )}
      </div>
    </details>
  );
}

export default MonthlyReportsPanel;
