import type { Position } from "../api/types";

export interface PositionRow {
  position: Position;
  isClosed: boolean;
  effectivePrice: number;
  quantity: number;
  cost: number;
  invested: number;
  currentValue: number;
  pnlValue: number;
  pnlPercent: number;
  intradayAbs: number | null;
  intradayPercent: number | null;
  tenDayPercent: number | null;
}

export interface RangeStats {
  pnlRange: { min: number; max: number; median: number };
  intradayRange: { min: number; max: number };
  tenDayRange: { min: number; max: number };
}

export interface PortfolioTotals {
  totalInvestAll: number;
  totalInvestClosed: number;
  totalMarketValueOpen: number;
  plVsInvestAll: number;
  plPctVsInvestAll: number;
  intradayAbsSum: number;
  portfolioIntradayPct: number;
  tenDayAbsolute: number;
  tenDayPctTotal: number;
  realizedPlClosed: number;
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const median = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }
  return sorted[midpoint];
};

export interface PortfolioComputation {
  rows: PositionRow[];
  ranges: RangeStats;
  totals: PortfolioTotals;
}

export function buildPortfolioView(positions: Position[]): PortfolioComputation {
  const rows: PositionRow[] = [];
  const pnlValues: number[] = [];
  const intradayPercents: number[] = [];
  const tenDayPercents: number[] = [];

  let totalMarketValueOpen = 0;
  let intradayAbsSum = 0;
  let totalMarketValueOpen10d = 0;
  let totalInvestOpen = 0;
  let totalInvestClosed = 0;
  let realizedPlClosed = 0;

  for (const position of positions) {
    const isClosed = Boolean(position.is_closed);
    const quantity = toNumber(position.quantity);
    const cost = toNumber(position.cost_price);
    const invested = quantity * cost;

    const closingPrice = position.closing_price;
    const currentPrice = toNumber(position.current_price);
    const effectivePrice =
      isClosed && closingPrice !== null && closingPrice !== undefined
        ? toNumber(closingPrice)
        : currentPrice;
    const currentValue = quantity * effectivePrice;
    const pnlValue = currentValue - invested;
    const pnlPercent = invested ? (pnlValue / invested) * 100 : 0;

    let intradayAbs: number | null = null;
    let intradayPercent: number | null = null;
    if (!isClosed) {
      const change = position.intraday_change;
      const changePct = position.intraday_change_pct;
      if (change !== null && change !== undefined) {
        const val = toNumber(change, NaN);
        intradayAbs = Number.isNaN(val) ? null : val * quantity;
      }
      if (changePct !== null && changePct !== undefined) {
        const pct = toNumber(changePct, NaN);
        intradayPercent = Number.isNaN(pct) ? null : pct;
        if (intradayPercent !== null) {
          intradayPercents.push(intradayPercent);
        }
      }
    }

    let tenDayPercent: number | null = null;
    let price10dValue: number | null = null;
    if (!isClosed) {
      const rawPrice10d =
        position.price_10d !== null && position.price_10d !== undefined
          ? toNumber(position.price_10d, NaN)
          : NaN;
      if (!Number.isNaN(rawPrice10d) && rawPrice10d !== 0) {
        price10dValue = rawPrice10d;
        tenDayPercent = ((effectivePrice - rawPrice10d) / rawPrice10d) * 100;
      }

      if (
        (tenDayPercent === null || Number.isNaN(tenDayPercent)) &&
        position.change_10d_pct !== null &&
        position.change_10d_pct !== undefined
      ) {
        const pct = toNumber(position.change_10d_pct, NaN);
        if (!Number.isNaN(pct)) {
          tenDayPercent = pct;
          if (price10dValue === null || Number.isNaN(price10dValue) || price10dValue === 0) {
            const implied = effectivePrice / (1 + pct / 100);
            if (Number.isFinite(implied) && implied !== 0) {
              price10dValue = implied;
            }
          }
        }
      }

      if (tenDayPercent !== null && !Number.isNaN(tenDayPercent)) {
        tenDayPercents.push(tenDayPercent);
      } else {
        tenDayPercent = null;
      }
    }

    rows.push({
      position,
      isClosed,
      effectivePrice,
      quantity,
      cost,
      invested,
      currentValue,
      pnlValue,
      pnlPercent,
      intradayAbs,
      intradayPercent,
      tenDayPercent,
    });

    pnlValues.push(pnlValue);

    if (!isClosed) {
      totalInvestOpen += invested;
      totalMarketValueOpen += quantity * currentPrice;
      if (position.intraday_change !== null && position.intraday_change !== undefined) {
        const change = toNumber(position.intraday_change, NaN);
        if (!Number.isNaN(change)) {
          intradayAbsSum += change * quantity;
        }
      }
      if (price10dValue !== null && !Number.isNaN(price10dValue)) {
        totalMarketValueOpen10d += quantity * price10dValue;
      }
    } else {
      totalInvestClosed += invested;
      realizedPlClosed += pnlValue;
    }
  }

  const pnlRange = {
    min: pnlValues.length ? Math.min(...pnlValues) : 0,
    max: pnlValues.length ? Math.max(...pnlValues) : 0,
    median: pnlValues.length ? median(pnlValues) : 0,
  };

  const intradayRange = {
    min: intradayPercents.length ? Math.min(...intradayPercents) : 0,
    max: intradayPercents.length ? Math.max(...intradayPercents) : 0,
  };

  const tenDayRange = {
    min: tenDayPercents.length ? Math.min(...tenDayPercents) : 0,
    max: tenDayPercents.length ? Math.max(...tenDayPercents) : 0,
  };

  const plOpen = totalMarketValueOpen - totalInvestOpen;
  const plVsInvestAll = plOpen + realizedPlClosed;
  const totalInvestAll = totalInvestOpen;
  const plPctVsInvestAll = totalInvestAll ? (plVsInvestAll / totalInvestAll) * 100 : 0;
  const portfolioIntradayPct = totalMarketValueOpen
    ? (intradayAbsSum / totalMarketValueOpen) * 100
    : 0;

  const tenDayAbsolute = totalMarketValueOpen - totalMarketValueOpen10d;
  const tenDayPctTotal = totalMarketValueOpen10d
    ? (tenDayAbsolute / totalMarketValueOpen10d) * 100
    : 0;

  return {
    rows,
    ranges: { pnlRange, intradayRange, tenDayRange },
    totals: {
      totalInvestAll,
      totalInvestClosed,
      totalMarketValueOpen,
      plVsInvestAll,
      plPctVsInvestAll,
      intradayAbsSum,
      portfolioIntradayPct,
      tenDayAbsolute,
      tenDayPctTotal,
      realizedPlClosed,
    },
  };
}
