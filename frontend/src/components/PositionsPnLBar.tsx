import { useCallback, useEffect, useMemo, useState } from "react";
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
  tenDayValue: number | null;
  tenDayPercent: number | null;
  oneYearValue: number | null;
  oneYearPercent: number | null;
  intradayValue: number | null;
  intradayPercent: number | null;
  currency: string | null | undefined;
  isClosed: boolean;
}

const POSITIVE = "#34a853";
const NEGATIVE = "#d93025";

type PerfMetric = "value" | "percent";
type PerfPeriod = "all" | "1y" | "10d" | "intraday";

const METRIC_STORAGE_KEY = "aiportfolio:positionsPnlMetric";
const PERIOD_STORAGE_KEY = "aiportfolio:positionsPnlPeriod";

const loadMetric = (): PerfMetric => {
  if (typeof window === "undefined") {
    return "value";
  }
  const raw = window.localStorage.getItem(METRIC_STORAGE_KEY);
  return raw === "percent" ? "percent" : "value";
};

const loadPeriod = (): PerfPeriod => {
  if (typeof window === "undefined") {
    return "all";
  }
  const raw = window.localStorage.getItem(PERIOD_STORAGE_KEY);
  if (raw === "1y" || raw === "10d" || raw === "intraday") {
    return raw;
  }
  return "all";
};

const toFinite = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const impliedBaseFromPercent = (effectivePrice: number, percent: number): number | null => {
  const denom = 1 + percent / 100;
  if (!Number.isFinite(denom) || denom === 0) {
    return null;
  }
  const base = effectivePrice / denom;
  return Number.isFinite(base) && base !== 0 ? base : null;
};

function buildBarData(rows: PositionRow[]): BarDatum[] {
  return rows
    .filter((row) => Number.isFinite(row.pnlValue))
    .map((row) => {
      const symbol = row.position.symbol;
      const longName = row.position.long_name || null;
      const label = symbol || row.position.id || longName || "Position";
      const isClosed = row.isClosed;
      const qty = row.quantity;
      const eff = row.effectivePrice;

      const intradayValue = isClosed ? null : row.intradayAbs;
      const intradayPercent = isClosed ? null : row.intradayPercent;

      const tenDayPercent = isClosed
        ? null
        : row.tenDayPercent ?? toFinite(row.position.change_10d_pct);
      let tenDayBase = isClosed ? null : toFinite(row.position.price_10d);
      if (!isClosed && (tenDayBase === null || tenDayBase === 0) && tenDayPercent !== null) {
        tenDayBase = impliedBaseFromPercent(eff, tenDayPercent);
      }
      const tenDayValue = !isClosed && tenDayBase !== null ? (eff - tenDayBase) * qty : null;

      const oneYearPercent = isClosed
        ? null
        : row.oneYearPercent ?? toFinite(row.position.change_1y_pct);
      let oneYearBase = isClosed ? null : toFinite(row.position.price_1y);
      if (
        !isClosed &&
        (oneYearBase === null || oneYearBase === 0) &&
        oneYearPercent !== null
      ) {
        oneYearBase = impliedBaseFromPercent(eff, oneYearPercent);
      }
      const oneYearValue = !isClosed && oneYearBase !== null ? (eff - oneYearBase) * qty : null;

      return {
        label,
        fullName: longName,
        pnlValue: row.pnlValue,
        pnlPercent: row.pnlPercent,
        tenDayValue,
        tenDayPercent,
        oneYearValue,
        oneYearPercent,
        intradayValue,
        intradayPercent,
        currency: row.position.currency,
        isClosed: row.isClosed,
      };
    })
    .sort((a, b) => a.pnlValue - b.pnlValue);
}

export function PositionsPnLBar({ rows }: PositionsPnLBarProps) {
  const [metric, setMetric] = useState<PerfMetric>(() => loadMetric());
  const [period, setPeriod] = useState<PerfPeriod>(() => loadPeriod());

  useEffect(() => {
    try {
      window.localStorage.setItem(METRIC_STORAGE_KEY, metric);
    } catch {
      // Ignore storage failures.
    }
  }, [metric]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PERIOD_STORAGE_KEY, period);
    } catch {
      // Ignore storage failures.
    }
  }, [period]);

  const rawData = useMemo(() => buildBarData(rows), [rows]);

  const periodLabel = useMemo(() => {
    switch (period) {
      case "intraday":
        return "Intraday";
      case "10d":
        return "10D";
      case "1y":
        return "1Y";
      case "all":
      default:
        return "All time";
    }
  }, [period]);

  const getMetricValue = useCallback(
    (datum: BarDatum): number | null => {
      if (period === "all") {
        return metric === "percent" ? datum.pnlPercent : datum.pnlValue;
      }
      if (period === "1y") {
        return metric === "percent" ? datum.oneYearPercent : datum.oneYearValue;
      }
      if (period === "10d") {
        return metric === "percent" ? datum.tenDayPercent : datum.tenDayValue;
      }
      return metric === "percent" ? datum.intradayPercent : datum.intradayValue;
    },
    [metric, period],
  );

  type PreparedDatum = BarDatum & { chartValue: number; metricValue: number | null };

  const data = useMemo(() => {
    const out: PreparedDatum[] = rawData.map((datum) => {
      const metricValue = getMetricValue(datum);
      const chartValue = metricValue === null || Number.isNaN(metricValue) ? 0 : metricValue;
      return { ...datum, chartValue, metricValue };
    });

    out.sort((a, b) => {
      const aMissing = a.metricValue === null || Number.isNaN(a.metricValue);
      const bMissing = b.metricValue === null || Number.isNaN(b.metricValue);
      if (aMissing !== bMissing) {
        return aMissing ? 1 : -1;
      }
      return a.chartValue - b.chartValue;
    });

    return out;
  }, [getMetricValue, rawData]);

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={period === "all" ? "btn" : "btn secondary"}
              onClick={() => setPeriod("all")}
              aria-pressed={period === "all"}
            >
              All time
            </button>
            <button
              type="button"
              className={period === "1y" ? "btn" : "btn secondary"}
              onClick={() => setPeriod("1y")}
              aria-pressed={period === "1y"}
            >
              1Y
            </button>
            <button
              type="button"
              className={period === "10d" ? "btn" : "btn secondary"}
              onClick={() => setPeriod("10d")}
              aria-pressed={period === "10d"}
            >
              10D
            </button>
            <button
              type="button"
              className={period === "intraday" ? "btn" : "btn secondary"}
              onClick={() => setPeriod("intraday")}
              aria-pressed={period === "intraday"}
            >
              Intraday
            </button>
          </div>
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

                    const valueForPeriod =
                      period === "all"
                        ? datum.pnlValue
                        : period === "1y"
                          ? datum.oneYearValue
                          : period === "10d"
                            ? datum.tenDayValue
                            : datum.intradayValue;

                    const pctForPeriod =
                      period === "all"
                        ? datum.pnlPercent
                        : period === "1y"
                          ? datum.oneYearPercent
                          : period === "10d"
                            ? datum.tenDayPercent
                            : datum.intradayPercent;

                    const valueFormatted =
                      valueForPeriod === null || Number.isNaN(valueForPeriod)
                        ? "—"
                        : formatCurrency(valueForPeriod, datum.currency ?? currencyHint);
                    const pctFormatted =
                      pctForPeriod === null || Number.isNaN(pctForPeriod)
                        ? "—"
                        : formatSignedPercent(pctForPeriod);

                    const valueLabel =
                      period === "intraday"
                        ? "Intraday"
                        : period === "10d"
                          ? "10D"
                          : period === "1y"
                            ? "1Y"
                            : "P/L";

                    const pctLabel = `${valueLabel} %`;
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
                          {valueLabel}: {valueFormatted}{" "}
                          <span className="muted" style={{ marginLeft: 6 }}>
                            ({pctLabel}: {pctFormatted})
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
                  dataKey="chartValue"
                  barSize={14}
                  isAnimationActive={false}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.label}
                      fill={
                        entry.metricValue === null || Number.isNaN(entry.metricValue)
                          ? "#e5e7eb"
                          : entry.metricValue >= 0
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
            Sorted from lowest to highest {periodLabel} {metric === "percent" ? "%" : "Value"} (tooltip shows value and %).
          </p>
        </>
      )}
    </div>
  );
}

export default PositionsPnLBar;
