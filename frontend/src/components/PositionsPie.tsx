import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { PieLabelRenderProps } from "recharts";
import type { PositionRow } from "../utils/portfolio";
import { formatCurrency } from "../utils/format";

interface PositionsPieProps {
  rows: PositionRow[];
}

interface PieDatum {
  label: string;
  symbol: string | null;
  value: number;
  currency: string | null | undefined;
}

const PIE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#ea580c",
  "#9333ea",
  "#0ea5e9",
  "#a3e635",
  "#14b8a6",
  "#facc15",
  "#fb7185",
  "#7c3aed",
  "#d946ef",
];

const MIN_LABEL_PERCENT = 0.04;

function buildPieData(rows: PositionRow[]): PieDatum[] {
  return rows
    .filter((row) => !row.isClosed && row.position.valuation?.market_value !== null)
    .map((row) => {
      const symbol = row.position.symbol || null;
      const companyName = row.position.display_name || row.position.long_name || null;
      const label = companyName || symbol || row.position.id || "Position";
      const value = Math.abs(row.position.valuation?.market_value ?? 0);
      return {
        label,
        symbol,
        value: Number.isFinite(value) ? value : 0,
        currency: "EUR",
      };
    })
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
}

export default function PositionsPie({ rows }: PositionsPieProps) {
  const data = useMemo(() => buildPieData(rows), [rows]);
  const totalValue = useMemo(() => data.reduce((sum, entry) => sum + entry.value, 0), [data]);
  const currencyHint = useMemo(
    () => data.find((entry) => entry.currency)?.currency ?? data[0]?.currency ?? "USD",
    [data],
  );
  const legendItems = useMemo(
    () =>
      data.map((entry, index) => ({
        id: `${entry.label}-${index}`,
        label: entry.label,
        symbol: entry.symbol,
        color: PIE_COLORS[index % PIE_COLORS.length],
      })),
    [data],
  );

  const renderLabel = ({
    name,
    percent,
    x,
    y,
    textAnchor,
    dominantBaseline,
    payload,
  }: PieLabelRenderProps) => {
    if (!percent || percent < MIN_LABEL_PERCENT) {
      return null;
    }
    const datum = payload as PieDatum | undefined;
    const display = datum?.label ?? (typeof name === "string" ? name : null);
    if (!display) {
      return null;
    }
    const labelText = `${display} ${(percent * 100).toFixed(1)}%`;
    return (
      <text
        x={x}
        y={y}
        textAnchor={textAnchor === "start" || textAnchor === "end" ? textAnchor : "middle"}
        dominantBaseline={dominantBaseline || "central"}
        fontSize={12}
        fontWeight={600}
        fill="#0f172a"
      >
        {datum?.symbol ? <title>{datum.symbol}</title> : null}
        {labelText}
      </text>
    );
  };

  return (
    <div className="card">
      <div className="section-header">
        <h2>Portfolio Mix</h2>
      </div>
      {!data.length || totalValue <= 0 ? (
        <div className="empty-state">Add positions to visualize your allocation.</div>
      ) : (
        <>
          <div className="chart-container" style={{ marginBottom: 12, height: 360 }}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 36, right: 16, bottom: 16, left: 16 }}>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={70}
                  outerRadius={120}
                  cy="55%"
                  labelLine={false}
                  label={renderLabel}
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={`${entry.label}-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, _name, props) => {
                    const datum = (props?.payload as PieDatum | undefined) ?? null;
                    const label = datum?.symbol
                      ? `${datum.label} (${datum.symbol})`
                      : datum?.label || "";
                    return [
                      formatCurrency(value, datum?.currency ?? currencyHint),
                      label,
                    ] as [string, string];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="pie-legend">
            {legendItems.map((item) => (
              <span
                key={item.id}
                className="pie-legend-item"
                title={item.symbol ? `${item.label} (${item.symbol})` : item.label}
              >
                <span className="pie-legend-swatch" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
            Share of positions with available EUR valuations (total {formatCurrency(totalValue, currencyHint)}).
          </p>
        </>
      )}
    </div>
  );
}
