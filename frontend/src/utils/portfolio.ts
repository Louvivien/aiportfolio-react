import type { Position } from "../api/types";

export interface PositionRow {
  position: Position;
  isClosed: boolean;
  effectivePrice: number | null;
  quantity: number;
  cost: number | null;
  stopPrice: number | null;
  invested: number | null;
  currentValue: number | null;
  pnlValue: number | null;
  pnlPercent: number | null;
  intradayAbs: number | null;
  intradayPercent: number | null;
  tenDayPercent: number | null;
  oneYearPercent: number | null;
}

export interface RangeStats {
  pnlRange: { min: number; max: number; median: number };
  intradayRange: { min: number; max: number };
  tenDayRange: { min: number; max: number };
  oneYearRange: { min: number; max: number };
}

export interface PortfolioTotals {
  totalInvestAll: number | null;
  totalInvestClosed: number | null;
  totalMarketValueOpen: number | null;
  plOpen: number | null;
  plOpenPct: number | null;
  plVsInvestAll: number | null;
  plPctVsInvestAll: number | null;
  intradayAbsSum: number | null;
  portfolioIntradayPct: number | null;
  tenDayAbsolute: number | null;
  tenDayPctTotal: number | null;
  oneYearAbsolute: number | null;
  oneYearPctTotal: number | null;
  realizedPlClosed: number | null;
}

const finite = (value: unknown): number | null => value === null || value === undefined || value === ""
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const sum = (values: (number | null | undefined)[]) => values.some((v) => finite(v) === null)
  ? null : (values as number[]).reduce((a, b) => a + b, 0);
const pct = (gain: number | null, basis: number | null) => gain === null || basis === null || basis <= 0 ? null : gain / basis * 100;
const range = (values: (number | null)[]) => {
  const sorted = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0,
    median: !sorted.length ? 0 : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 };
};
export interface PortfolioComputation {
  rows: PositionRow[];
  ranges: RangeStats;
  totals: PortfolioTotals;
}

export function buildPortfolioView(positions: Position[]): PortfolioComputation {
  const today = new Date().toISOString().slice(0, 10);
  const rows: PositionRow[] = positions.map((position) => {
    const lots = (position.purchase_lots?.length ? position.purchase_lots : [position])
      .filter((lot) => !lot.purchase_date || lot.purchase_date.slice(0, 10) <= today);
    const closedByToday = (lot: (typeof lots)[number]) => Boolean(lot.is_closed || position.is_closed) &&
      (!lot.closing_date || lot.closing_date.slice(0, 10) <= today);
    const isClosed = lots.length > 0 && lots.every(closedByToday);
    const selected = isClosed ? lots : lots.filter((lot) => !closedByToday(lot));
    const quantity = sum(selected.map((lot) => finite(lot.quantity))) ?? 0;
    const invested = sum(selected.map((lot) => {
      const cost = finite(lot.cost_price);
      return cost === null ? null : cost * lot.quantity;
    }));
    const cost = invested !== null && quantity > 0 ? invested / quantity : null;
    const proceeds = sum(selected.map((lot) => {
      const price = finite(lot.closing_price ?? position.closing_price);
      return price === null ? null : lot.quantity * price;
    }));
    const effectivePrice = isClosed ? (proceeds !== null && quantity > 0 ? proceeds / quantity : null) : finite(position.current_price);
    const currentValue = effectivePrice === null ? null : effectivePrice * quantity;
    const pnlValue = currentValue === null || invested === null ? null : currentValue - invested;
    const native = position.native_valuation;
    return { position, isClosed, quantity, cost, invested, effectivePrice, currentValue, pnlValue,
      stopPrice: cost !== null && quantity > 0 ? Math.max(0, cost - 100 / quantity) : null,
      pnlPercent: pct(pnlValue, invested),
      intradayAbs: native?.intraday.gain ?? null,
      intradayPercent: native?.intraday.percent ?? null,
      tenDayPercent: native?.ten_day.percent ?? null,
      oneYearPercent: native?.one_year.percent ?? null,
    };
  });
  const metric = (key: 'open_cost' | 'closed_cost' | 'market_value' | 'realized_pl' | 'unrealized_pl' | 'total_pl') =>
    sum(positions.map((p) => p.valuation?.[key]));
  const period = (key: 'intraday' | 'ten_day' | 'one_year') => {
    const gain = sum(positions.map((p) => p.valuation?.[key].gain));
    return { gain, percent: pct(gain, sum(positions.map((p) => p.valuation?.[key].basis))) };
  };
  const totalInvestAll = metric('open_cost');
  const totalInvestClosed = metric('closed_cost');
  const plOpen = metric('unrealized_pl');
  const plVsInvestAll = metric('total_pl');
  const intraday = period('intraday'), ten = period('ten_day'), year = period('one_year');
  return { rows, ranges: {
    pnlRange: range(rows.map((r) => r.pnlValue)), intradayRange: range(rows.map((r) => r.intradayPercent)),
    tenDayRange: range(rows.map((r) => r.tenDayPercent)), oneYearRange: range(rows.map((r) => r.oneYearPercent)),
  }, totals: {
    totalInvestAll, totalInvestClosed, totalMarketValueOpen: metric('market_value'),
    plOpen, plOpenPct: pct(plOpen, totalInvestAll), plVsInvestAll,
    plPctVsInvestAll: pct(plVsInvestAll, sum([totalInvestAll, totalInvestClosed])),
    intradayAbsSum: intraday.gain, portfolioIntradayPct: intraday.percent,
    tenDayAbsolute: ten.gain, tenDayPctTotal: ten.percent,
    oneYearAbsolute: year.gain, oneYearPctTotal: year.percent, realizedPlClosed: metric('realized_pl'),
  } };
}
