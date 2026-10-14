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

export interface PerformanceMovement {
  id: string;
  date: string;
  direction: 'deposit' | 'withdrawal' | 'promotion';
  amount_cents: number;
  currency: 'EUR';
  external_to_combined_scope: boolean;
  date_confirmed: boolean;
  account?: string;
  note?: string;
}
export interface AnnualPerformanceInput {
  dated_movements: PerformanceMovement[];
  opening_cash_eur: number | null;
  opening_cash_status?: string;
  current_cash_eur: number | null;
  current_cash_date: string | null;
  flow_history_complete: boolean;
  transfers_reviewed: boolean;
  scope_complete: boolean;
  performance_scope?: { excluded_symbols?: string[]; [key: string]: unknown };
}
export interface AnnualSnapshot extends PerformanceSnapshot {
  date?: string;
  positions?: { symbol: string; position_id: string; quantity: number; price: number | null;
    price_date: string | null; currency: string | null; value_eur: number | null; fx?: { rate: number; date: string } | null }[];
}
export interface AnnualManagement {
  year: number;
  revision: number;
  today: string;
  closed: boolean;
  opening_source_year: number | null;
  opening_needs_review: boolean;
  years: number[];
  input: AnnualPerformanceInput;
  report: PersonalPerformance;
  opening_snapshot: AnnualSnapshot;
  closing_snapshot: AnnualSnapshot | null;
}
export interface AnnualClosePreview {
  _id: string;
  snapshot: AnnualSnapshot;
  report: PersonalPerformance;
  updates_next_opening: boolean;
}
