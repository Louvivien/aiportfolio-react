export interface PerformanceSnapshot {
  known_value_eur: number;
  complete: boolean;
  missing_symbols: string[];
  position_count: number;
  cash_eur: number | null;
  total_eur: number | null;
}

export interface PersonalPerformance {
  label: string;
  currency: string;
  period_start: string;
  opening_valuation_date: string;
  as_of: string;
  status: "complete" | "incomplete" | "unavailable";
  opening: PerformanceSnapshot;
  current: PerformanceSnapshot;
  flows: {
    personal_deposits_eur: number;
    withdrawals_eur: number;
    promotions_eur: number;
    net_personal_eur: number;
    net_capital_eur: number;
    movements: { id: string; date: string; type: "deposit" | "withdrawal" | "promotion"; amount_eur: number; date_confirmed: boolean }[];
  };
  missing: string[];
  annualized_xirr: number | null;
  effective_return_pct: number | null;
  net_gain_eur: number | null;
  indicative?: {
    annualized_xirr: number | null;
    effective_return_pct: number | null;
    net_gain_eur: number | null;
    assumptions: string[];
  } | null;
  methodology: string;
}
