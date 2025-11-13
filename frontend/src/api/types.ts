export interface Tag {
  id: string;
  name: string;
}

export interface Position {
  id?: string;
  _id?: string;
  symbol: string;
  quantity: number;
  cost_price: number;
  current_price?: number | null;
  long_name?: string | null;
  intraday_change?: number | null;
  intraday_change_pct?: number | null;
  currency?: string | null;
  price_10d?: number | null;
  change_10d_pct?: number | null;
  tags: string[];
  is_closed?: boolean;
  closing_price?: number | null;
  purchase_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PortfolioSummary {
  total_market_value: number;
  total_unrealized_pl: number;
}

export interface TagSummaryRow {
  tag: string;
  total_quantity: number;
  total_market_value: number;
  total_unrealized_pl: number;
  intraday_change_pct: number | null;
  change_10d_pct: number | null;
}

export interface TimeseriesPoint {
  date: string;
  market_value: number;
  unrealized_pl: number;
}

export interface TagTimeseriesResponse {
  tags: Record<string, TimeseriesPoint[]>;
  total: TimeseriesPoint[];
}

export interface CreatePositionPayload {
  symbol: string;
  quantity: number;
  cost_price: number;
  tags: string[];
  is_closed: boolean;
  closing_price: number | null;
  purchase_date?: string | null;
}

export interface UpdatePositionPayload {
  symbol?: string;
  quantity?: number;
  cost_price?: number;
  tags?: string[];
  is_closed?: boolean;
  closing_price?: number | null;
  purchase_date?: string | null;
}
