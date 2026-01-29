import type { Position } from "../api/types";

export type IndicatorOutcomeId = 0 | 1 | 2 | 3 | 4 | 5;

export type IndicatorTone = "positive" | "warning" | "negative" | "neutral";

export interface IndicatorOutcome {
  id: IndicatorOutcomeId;
  label: string;
  tone: IndicatorTone;
}

export type IndicatorStepStatus = "pass" | "fail" | "missing" | "skipped";

export interface IndicatorStep {
  id: string;
  label: string;
  condition: string;
  value: number | null;
  status: IndicatorStepStatus;
  failOutcome?: IndicatorOutcome;
}

export interface StockIndicatorResult {
  disabled: boolean;
  missingInputs: string[];
  outcome: IndicatorOutcome | null;
  steps: IndicatorStep[];
}

export const INDICATOR_OUTCOMES: Record<
  "lowRevenueGrowth" | "likelyOvervalued" | "lowProfitGrowth" | "weakProfitability" | "liquidityIssues" | "invest",
  IndicatorOutcome
> = {
  lowRevenueGrowth: { id: 0, label: "Low revenues growth", tone: "negative" },
  likelyOvervalued: { id: 1, label: "Likely overvalued", tone: "warning" },
  lowProfitGrowth: { id: 2, label: "Low profit growth", tone: "warning" },
  weakProfitability: { id: 3, label: "Weak profitability", tone: "negative" },
  liquidityIssues: { id: 4, label: "Liquidity issues", tone: "negative" },
  invest: { id: 5, label: "Invest!", tone: "positive" },
};

const indicatorCache = new Map<string, { signature: string; result: StockIndicatorResult }>();

const buildIndicatorSignature = (position: Position): string =>
  [
    position.indicator_disabled ? "1" : "0",
    position.revenue_growth_yoy_pct ?? "",
    position.pe_ratio ?? "",
    position.peg_ratio ?? "",
    position.roe_5y_avg_pct ?? "",
    position.quick_ratio ?? "",
  ].join("|");

export function evaluateStockIndicator(position: Position): StockIndicatorResult {
  const cacheKey = position.id ?? position._id ?? position.symbol;
  const signature = buildIndicatorSignature(position);
  const cached = indicatorCache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.result;
  }

  const revenueGrowth = position.revenue_growth_yoy_pct ?? null;
  const peRatio = position.pe_ratio ?? null;
  const pegRatio = position.peg_ratio ?? null;
  const roe5yAvg = position.roe_5y_avg_pct ?? null;
  const quickRatio = position.quick_ratio ?? null;

  const missingInputs: string[] = [];

  const steps: IndicatorStep[] = [];
  let stopped = false;
  let outcome: IndicatorOutcome | null = null;

  const pushStep = (
    id: string,
    label: string,
    condition: string,
    value: number | null,
    predicate: (value: number) => boolean,
    failOutcome: IndicatorOutcome,
    missingLabel: string,
  ) => {
    if (stopped) {
      steps.push({ id, label, condition, value, status: "skipped", failOutcome });
      return;
    }
    if (value === null || Number.isNaN(value)) {
      missingInputs.push(missingLabel);
      steps.push({ id, label, condition, value: null, status: "missing", failOutcome });
      stopped = true;
      return;
    }
    const passed = predicate(value);
    const status: IndicatorStepStatus = passed ? "pass" : "fail";
    steps.push({ id, label, condition, value, status, failOutcome });
    if (!passed) {
      stopped = true;
      outcome = failOutcome;
    }
  };

  pushStep(
    "revenueGrowth",
    "Step 1 — Revenue growth",
    "Latest revenue growth ≥ 10% YoY",
    revenueGrowth,
    (value) => value >= 10,
    INDICATOR_OUTCOMES.lowRevenueGrowth,
    "Revenue growth",
  );

  pushStep(
    "peRatio",
    "Step 2 — Valuation (P/E)",
    "P/E < 25",
    peRatio,
    (value) => value < 25,
    INDICATOR_OUTCOMES.likelyOvervalued,
    "P/E ratio",
  );

  pushStep(
    "pegRatio",
    "Step 3 — Growth-adjusted valuation (PEG)",
    "PEG < 2",
    pegRatio,
    (value) => value < 2,
    INDICATOR_OUTCOMES.lowProfitGrowth,
    "PEG ratio",
  );

  pushStep(
    "roeAvg",
    "Step 4 — Profitability quality (ROE)",
    "5-year avg ROE > 5%",
    roe5yAvg,
    (value) => value > 5,
    INDICATOR_OUTCOMES.weakProfitability,
    "ROE (5y avg)",
  );

  pushStep(
    "quickRatio",
    "Step 5 — Liquidity (Quick ratio)",
    "Quick ratio > 1.5",
    quickRatio,
    (value) => value > 1.5,
    INDICATOR_OUTCOMES.liquidityIssues,
    "Quick ratio",
  );

  const disabled = Boolean(position.indicator_disabled);

  if (!disabled && !outcome && stopped === false && missingInputs.length === 0 && quickRatio !== null) {
    outcome = INDICATOR_OUTCOMES.invest;
  }

  const result = {
    disabled,
    missingInputs,
    outcome: disabled ? null : outcome,
    steps,
  };

  indicatorCache.set(cacheKey, { signature, result });
  if (indicatorCache.size > 4000) {
    indicatorCache.clear();
  }

  return result;
}
