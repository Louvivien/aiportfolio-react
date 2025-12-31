import { useEffect, useMemo, useState } from "react";
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
import type { PositionRow } from "../utils/portfolio";
import { formatCurrency, formatSignedPercent } from "../utils/format";

interface PositionsPnLBarProps {
  rows: PositionRow[];
}

interface BarDatum {
  label: string;
  fullName: string | null;
  pnlValue: number;
  pnlPercent: number;
  currency: string | null | undefined;
  isClosed: boolean;
}

const POSITIVE = "#34a853";
const NEGATIVE = "#d93025";

type PerfMetric = "value" | "percent";

const STORAGE_KEY = "aiportfolio:positionsPnlMetric";

const loadMetric = (): PerfMetric => {
  if (typeof window === "undefined") {
    return "value";
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "percent" ? "percent" : "value";
};

function buildBarData(rows: PositionRow[]): BarDatum[] {
  return rows
    .filter((row) => Number.isFinite(row.pnlValue))
    .map((row) => {
      const symbol = row.position.symbol;
      const longName = row.position.long_name || null;
      const label = symbol || row.position.id || longName || "Position";
      return {
        label,
        fullName: longName,
        pnlValue: row.pnlValue,
        pnlPercent: row.pnlPercent,
        currency: row.position.currency,
        isClosed: row.isClosed,
      };
    })
    .sort((a, b) => a.pnlValue - b.pnlValue);
}

export function PositionsPnLBar({ rows }: PositionsPnLBarProps) {
  const [metric, setMetric] = useState<PerfMetric>(() => loadMetric());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, metric);
    } catch {
      // Ignore storage failures.
    }
  }, [metric]);

  const rawData = useMemo(() => buildBarData(rows), [rows]);
  const data = useMemo(() => {
    const out = [...rawData];
    out.sort((a, b) => {
      const av = metric === "percent" ? a.pnlPercent : a.pnlValue;
      const bv = metric === "percent" ? b.pnlPercent : b.pnlValue;
      return av - bv;
    });
    return out;
  }, [rawData, metric]);
  const currencyHint = useMemo(
    () => data.find((entry) => entry.currency)?.currency ?? data[0]?.currency ?? "USD",
    [data],
  );

  const height = useMemo(() => {
    // Horizontal bars: scale height with number of rows.
    const min = 260;
    const perRow = 26;
    const base = 120;
    const computed = base + perRow * data.length;
    return Math.min(900, Math.max(min, computed));
  }, [data.length]);

  return (
    <div className="card">
      <div className="section-header">
        <h2>Positions Performance (increasing)</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={metric === "value" ? "btn" : "btn secondary"}
            onClick={() => setMetric("value")}
            aria-pressed={metric === "value"}
          >
            P/L
          </button>
          <button
            type="button"
            className={metric === "percent" ? "btn" : "btn secondary"}
            onClick={() => setMetric("percent")}
            aria-pressed={metric === "percent"}
          >
            P/L %
          </button>
        </div>
      </div>

      {!data.length ? (
        <div className="empty-state">Add positions to visualize P/L by position.</div>
      ) : (
        <>
          <div className="chart-container" style={{ height }}>
            <ResponsiveContainer>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 10, right: 18, bottom: 10, left: 18 }}
              >
                <ReferenceLine x={0} stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  tickFormatter={(value) => {
                    const num = Number(value);
                    if (!Number.isFinite(num)) {
                      return "";
                    }
                    return metric === "percent"
                      ? formatSignedPercent(num, 1)
                      : formatCurrency(num, currencyHint);
                  }}
                  tick={{ fontSize: 12, fill: "#6b7280" }}
                  axisLine={{ stroke: "#e5e7eb" }}
                  tickLine={{ stroke: "#e5e7eb" }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={90}
                  tick={{ fontSize: 12, fill: "#111827" }}
                  axisLine={{ stroke: "#e5e7eb" }}
                  tickLine={{ stroke: "#e5e7eb" }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(229, 231, 235, 0.55)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) {
                      return null;
                    }
                    const datum = payload[0]?.payload as BarDatum | undefined;
                    if (!datum) {
                      return null;
                    }
                    const title = datum.fullName ? `${datum.label} — ${datum.fullName}` : datum.label;
                    const valueLine =
                      metric === "percent"
                        ? `P/L %: ${formatSignedPercent(datum.pnlPercent)}`
                        : `P/L: ${formatCurrency(datum.pnlValue, datum.currency ?? currencyHint)}`;
                    const otherLine =
                      metric === "percent"
                        ? `P/L: ${formatCurrency(datum.pnlValue, datum.currency ?? currencyHint)}`
                        : `P/L %: ${formatSignedPercent(datum.pnlPercent)}`;
                    return (
                      <div
                        style={{
                          background: "white",
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          padding: "10px 12px",
                          boxShadow: "0 14px 30px rgba(15, 23, 42, 0.12)",
                          maxWidth: 360,
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>{title}</div>
                        <div style={{ marginTop: 6 }}>
                          {valueLine}
                          <span className="muted" style={{ marginLeft: 6 }}>
                            ({otherLine})
                          </span>
                        </div>
                        {datum.isClosed && (
                          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                            Closed position
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey={metric === "percent" ? "pnlPercent" : "pnlValue"}
                  barSize={14}
                  isAnimationActive={false}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.label}
                      fill={
                        (metric === "percent" ? entry.pnlPercent : entry.pnlValue) >= 0
                          ? POSITIVE
                          : NEGATIVE
                      }
                      opacity={entry.isClosed ? 0.7 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
            Sorted from lowest to highest {metric === "percent" ? "P/L %" : "P/L"} (tooltip shows both).
          </p>
        </>
      )}
    </div>
  );
}

export default PositionsPnLBar;
