import { useEffect, useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TagTimeseriesResponse } from "../api/types";
import { formatNumber } from "../utils/format";

interface TimeseriesPanelProps {
  open: boolean;
  data: TagTimeseriesResponse | null;
  loading: boolean;
  error: string | null;
  period: string;
  interval: string;
  onPeriodChange: (value: string) => void;
  onIntervalChange: (value: string) => void;
  selection: string[];
  onSelectionChange: (values: string[]) => void;
  metric: "market_value" | "unrealized_pl";
  onMetricChange: (metric: "market_value" | "unrealized_pl") => void;
  normalize: boolean;
  onNormalizeChange: (value: boolean) => void;
  onClose: () => void;
}

const PERIOD_OPTIONS = ["1mo", "3mo", "6mo", "1y", "2y"];
const INTERVAL_OPTIONS = ["1d", "1wk", "1mo"];

type LineDatum = Record<string, string | number | null>;

const COLORS = [
  "#2563eb",
  "#14b8a6",
  "#f97316",
  "#9333ea",
  "#dc2626",
  "#0f766e",
  "#f59e0b",
  "#7c3aed",
];

const averageKey = "__average";

function buildChartDataset(
  data: TagTimeseriesResponse | null,
  selection: string[],
  metric: "market_value" | "unrealized_pl",
  normalize: boolean,
): LineDatum[] {
  if (!data || !selection.length) {
    return [];
  }

  const seriesMaps: Record<string, Map<string, number>> = {};

  for (const label of selection) {
    const rawSeries = label === "Total" ? data.total : data.tags[label] || [];
    const map = new Map<string, number>();
    let base: number | null = null;

    for (const point of rawSeries) {
      const rawValue = point[metric];
      if (rawValue === null || rawValue === undefined) {
        continue;
      }
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        continue;
      }

      if (normalize) {
        if (base === null) {
          if (value !== 0) {
            base = value;
          } else {
            continue;
          }
        }
        if (base === 0) {
          continue;
        }
        map.set(point.date, (value / base) * 100);
      } else {
        map.set(point.date, value);
      }
    }

    if (map.size > 0) {
      seriesMaps[label] = map;
    }
  }

  const dates = new Set<string>();
  Object.values(seriesMaps).forEach((series) => {
    series.forEach((_, date) => {
      dates.add(date);
    });
  });

  const sortedDates = Array.from(dates).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return sortedDates.map((date) => {
    const row: LineDatum = { date };
    const values: number[] = [];
    for (const label of selection) {
      const map = seriesMaps[label];
      if (!map) {
        row[label] = null;
        continue;
      }
      const value = map.get(date);
      row[label] = value ?? null;
      if (value !== null && value !== undefined) {
        values.push(value);
      }
    }
    if (values.length) {
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      row[averageKey] = avg;
    } else {
      row[averageKey] = null;
    }
    return row;
  });
}

function buildSelectionOptions(data: TagTimeseriesResponse | null): string[] {
  if (!data) {
    return [];
  }
  const tags = Object.keys(data.tags || {}).sort((a, b) => a.localeCompare(b));
  if (data.total && data.total.length) {
    return [...tags, "Total"];
  }
  return tags;
}

export function TimeseriesPanel({
  open,
  data,
  loading,
  error,
  period,
  interval,
  onPeriodChange,
  onIntervalChange,
  selection,
  onSelectionChange,
  metric,
  onMetricChange,
  normalize,
  onNormalizeChange,
  onClose,
}: TimeseriesPanelProps) {
  const options = useMemo(() => buildSelectionOptions(data), [data]);

  useEffect(() => {
    if (!options.length) {
      return;
    }
    const filtered = selection.filter((item) => options.includes(item));
    if (!filtered.length) {
      onSelectionChange([options[0]]);
    } else if (filtered.length !== selection.length) {
      onSelectionChange(filtered);
    }
  }, [options, selection, onSelectionChange]);

  const dataset = useMemo(
    () => buildChartDataset(data, selection, metric, normalize),
    [data, selection, metric, normalize],
  );

  if (!open) {
    return null;
  }

  const yAxisLabel = normalize ? "Indexed Value" : metric === "market_value" ? "Market Value" : "Unrealized P/L";

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal modal-wide">
        <div className="section-header">
          <h3>Tag Performance</h3>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid two" style={{ marginBottom: 16 }}>
          <div className="input-row">
            <label htmlFor="timeseries-period">Time range</label>
            <select
              id="timeseries-period"
              value={period}
              onChange={(event) => onPeriodChange(event.target.value)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="input-row">
            <label htmlFor="timeseries-interval">Sampling interval</label>
            <select
              id="timeseries-interval"
              value={interval}
              onChange={(event) => onIntervalChange(event.target.value)}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="input-row">
            <label htmlFor="timeseries-selection">Select categories</label>
            <select
              id="timeseries-selection"
              multiple
              value={selection}
              onChange={(event) =>
                onSelectionChange(Array.from(event.target.selectedOptions).map((opt) => opt.value))
              }
              size={Math.min(6, Math.max(3, options.length))}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="input-row">
            <label>Metric</label>
            <div style={{ display: "flex", gap: 12 }}>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="timeseries-metric"
                  value="market_value"
                  checked={metric === "market_value"}
                  onChange={() => onMetricChange("market_value")}
                />
                Market Value
              </label>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="timeseries-metric"
                  value="unrealized_pl"
                  checked={metric === "unrealized_pl"}
                  onChange={() => onMetricChange("unrealized_pl")}
                />
                Unrealized P/L
              </label>
            </div>
            <label className="checkbox-row" htmlFor="timeseries-normalize" style={{ marginTop: 12 }}>
              <input
                id="timeseries-normalize"
                type="checkbox"
                checked={normalize}
                onChange={(event) => onNormalizeChange(event.target.checked)}
              />
              Normalize series (rebased to 100)
            </label>
          </div>
        </div>

        {loading && <div className="loading">Loading timeseries…</div>}
        {error && <div className="error-text">{error}</div>}
        {!loading && !error && dataset.length === 0 && (
          <div className="empty-state">No data available for the selected categories.</div>
        )}
        {!loading && !error && dataset.length > 0 && (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dataset}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis
                  tickFormatter={(value) => formatNumber(Number(value))}
                  width={100}
                  label={{ value: yAxisLabel, angle: -90, position: "insideLeft" }}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === averageKey ? [formatNumber(value), "Average"] : [formatNumber(value), name]
                  }
                />
                <Legend />
                {selection.map((label, index) => (
                  <Line
                    key={label}
                    type="monotone"
                    dataKey={label}
                    stroke={COLORS[index % COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey={averageKey}
                  stroke="#111827"
                  strokeDasharray="4 4"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                  name="Average"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export default TimeseriesPanel;
