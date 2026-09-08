export interface MonthlyReportCoverage {
  start_value: number | null;
  end_value: number | null;
  performance_value: number | null;
  performance_pct: number | null;
}

export interface ValuationCoverage {
  value: number | null;
  basis: number | null;
  included_lots: number;
  missing_lots: number;
  issues: string[];
}

export interface PeriodPerformance {
  coverage?: ValuationCoverage;
  basis: number | null;
  gain: number | null;
  percent: number | null;
}
export interface PositionValuation {
  coverage?: Partial<Record<'open_cost' | 'closed_cost' | 'market_value' | 'realized_pl' | 'unrealized_pl' | 'total_pl', ValuationCoverage>>;
  currency: string;
  open_cost: number | null;
  closed_cost: number | null;
  market_value: number | null;
  realized_pl: number | null;
  unrealized_pl: number | null;
  total_pl: number | null;
  intraday: PeriodPerformance;
  ten_day: PeriodPerformance;
  one_year: PeriodPerformance;
  fx?: { rate: number; date: string; source: string } | null;
}

export interface Tag {
  id: string;
  name: string;
}

export interface FundamentalsSnapshot {
  epsCurrency?: string | null;
  epsShareBasis?: string | null;
  revenueGrowthLatestYoYPct?: number | null;
  revenueGrowthLatestYoYAsOfDate?: string | null;
  revenueLatest?: number | null;
  revenueLatestAsOfDate?: string | null;
  revenuePrevious?: number | null;
  revenuePreviousAsOfDate?: string | null;
  epsDiluted?: number | null;
  epsDilutedAsOfDate?: string | null;
  epsDilutedPositive?: number | null;
  epsDilutedPositiveAsOfDate?: string | null;
  epsCagrPct?: number | null;
  epsCagrFromDate?: string | null;
  epsCagrToDate?: string | null;
  roe5yAvgPct?: number | null;
  roe5yAvgFromDate?: string | null;
  roe5yAvgToDate?: string | null;
  quickRatio?: number | null;
  quickRatioAsOfDate?: string | null;
}

export interface PurchaseLot {
  id?: string | null;
  quantity: number;
  cost_price: number;
  purchase_date?: string | null;
  stop_loss_set?: boolean;
  is_closed?: boolean;
  closing_price?: number | null;
  closing_date?: string | null;
}

export interface Position {
  valuation?: PositionValuation;
  native_valuation?: PositionValuation;
  id?: string;
  _id?: string;
  symbol: string;
  display_name?: string | null;
  api_url?: string | null;
  quantity: number;
  cost_price: number;
  purchase_lots?: PurchaseLot[];
  current_price?: number | null;
  previous_close?: number | null;
  quote_date?: string | null;
  long_name?: string | null;
  intraday_change?: number | null;
  intraday_change_pct?: number | null;
  currency?: string | null;
  price_10d?: number | null;
  change_10d_pct?: number | null;
  price_1y?: number | null;
  change_1y_pct?: number | null;
  tags: string[];
  is_closed?: boolean;
  closing_price?: number | null;
  closing_date?: string | null;
  purchase_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  fundamentals_updated_at?: string | null;
  fundamentals_snapshot_updated_at?: string | null;
  fundamentals_snapshot?: FundamentalsSnapshot | null;
  boursorama_forum_url?: string | null;
  revenue_growth_yoy_pct?: number | null;
  pe_ratio?: number | null;
  peg_ratio?: number | null;
  roe_5y_avg_pct?: number | null;
  quick_ratio?: number | null;
  indicator_disabled?: boolean;
  stop_loss_set?: boolean;
}

export interface PortfolioSummary {
  total_market_value: number | null;
  total_unrealized_pl: number | null;
}

export interface TagSummaryRow {
  tag: string;
  total_quantity: number;
  total_market_value: number | null;
  total_unrealized_pl: number | null;
  intraday_change_pct: number | null;
  change_10d_pct: number | null;
  change_1y_pct: number | null;
}

export interface TimeseriesPoint {
  date: string;
  market_value: number | null;
  unrealized_pl: number | null;
}

export interface TagTimeseriesResponse {
  tags: Record<string, TimeseriesPoint[]>;
  total: TimeseriesPoint[];
}

export interface MonthlyReportSummary {
  coverage?: MonthlyReportCoverage;
  incomplete?: boolean;
  start_value: number | null;
  end_value: number | null;
  performance_value: number | null;
  performance_pct: number | null;
  positions_count: number;
  tags_count: number;
  positions_total: number;
  positions_skipped: number;
  lots_included: number;
  lots_skipped: number;
}

export interface MonthlyReportTagRow {
  coverage?: MonthlyReportCoverage;
  incomplete?: boolean;
  tag: string;
  start_value: number | null;
  end_value: number | null;
  performance_value: number | null;
  performance_pct: number | null;
  positions_count: number;
}

export interface MonthlyReportPositionRow {
  coverage?: MonthlyReportCoverage;
  incomplete?: boolean;
  position_id: string | null;
  symbol: string;
  name: string;
  currency?: string | null;
  tags: string[];
  quantity: number;
  start_value: number | null;
  end_value: number | null;
  performance_value: number | null;
  performance_pct: number | null;
  start_date: string | null;
  end_date: string | null;
  start_price: number | null;
  end_price: number | null;
  start_basis: "cost" | "market" | "mixed" | null;
  end_basis: "closing" | "market" | "mixed" | null;
  included_lots: number;
  skipped_lots: number;
  notes: string[];
}

export interface MonthlyReportSkippedPosition {
  incomplete?: boolean;
  position_id: string | null;
  symbol: string;
  name: string;
  reason: string;
}

export interface MonthlyPerformanceReport {
  methodology?: string;
  currency?: string;
  id?: string;
  _id?: string;
  month: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  created_at?: string;
  updated_at?: string;
  summary: MonthlyReportSummary;
  tags: MonthlyReportTagRow[];
  positions: MonthlyReportPositionRow[];
  skipped_positions: MonthlyReportSkippedPosition[];
}

export interface MonthlyReportListItem {
  needs_generation?: boolean;
  id?: string;
  month: string;
  period_start: string;
  period_end: string;
  generated_at: string | null;
  performance_value: number | null;
  performance_pct: number | null;
  start_value: number | null;
  end_value: number | null;
  positions_count: number;
  tags_count: number;
}

export interface MonthlyReportsListResponse {
  latest_due_month: string;
  reports: MonthlyReportListItem[];
}

export interface ForumPost {
  title: string;
  topic_url: string | null;
  author: string | null;
  author_profile_url: string | null;
  created_at: string | null;
  last_reply_at: string | null;
  last_reply_author: string | null;
  last_reply_profile_url: string | null;
  likes: number | null;
  messages: number | null;
}

export interface ForumPostsResponse {
  forum_url: string | null;
  posts: ForumPost[];
}

export interface PortfolioNewsItem {
  id: string;
  title: string;
  date: string;
  symbols: string[];
  publisher: string | null;
  url: string | null;
  source: string | null;
}

export interface PortfolioAgendaItem {
  id: string;
  title: string;
  date: string;
  end_date: string | null;
  symbols: string[];
  event_type: string;
  source: string | null;
  url: string | null;
  company_name?: string | null;
  time_label?: string | null;
  details?: string[];
}

export interface NewsAgendaResponse {
  generated_at: string;
  symbols: string[];
  news: PortfolioNewsItem[];
  agenda: PortfolioAgendaItem[];
  deduped_count: number;
  errors?: Record<string, string>;
}

export interface CreatePositionPayload {
  symbol: string;
  display_name?: string | null;
  api_url?: string | null;
  api_token?: string | null;
  quantity: number;
  cost_price: number;
  purchase_lots?: PurchaseLot[];
  tags: string[];
  is_closed: boolean;
  closing_price: number | null;
  closing_date?: string | null;
  purchase_date?: string | null;
  boursorama_forum_url?: string | null;
  revenue_growth_yoy_pct?: number | null;
  pe_ratio?: number | null;
  peg_ratio?: number | null;
  roe_5y_avg_pct?: number | null;
  quick_ratio?: number | null;
  indicator_disabled?: boolean;
  stop_loss_set?: boolean;
}

export interface UpdatePositionPayload {
  symbol?: string;
  display_name?: string | null;
  api_url?: string | null;
  api_token?: string | null;
  quantity?: number;
  cost_price?: number;
  purchase_lots?: PurchaseLot[];
  tags?: string[];
  is_closed?: boolean;
  closing_price?: number | null;
  closing_date?: string | null;
  purchase_date?: string | null;
  boursorama_forum_url?: string | null;
  revenue_growth_yoy_pct?: number | null;
  pe_ratio?: number | null;
  peg_ratio?: number | null;
  roe_5y_avg_pct?: number | null;
  quick_ratio?: number | null;
  indicator_disabled?: boolean;
  stop_loss_set?: boolean;
}
