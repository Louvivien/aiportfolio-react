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
  price_1y?: number | null;
  change_1y_pct?: number | null;
  tags: string[];
  is_closed?: boolean;
  closing_price?: number | null;
  closing_date?: string | null;
  purchase_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  boursorama_forum_url?: string | null;
  revenue_growth_yoy_pct?: number | null;
  pe_ratio?: number | null;
  peg_ratio?: number | null;
  roe_5y_avg_pct?: number | null;
  quick_ratio?: number | null;
  indicator_disabled?: boolean;
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
  change_1y_pct: number | null;
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

export interface CreatePositionPayload {
  symbol: string;
  quantity: number;
  cost_price: number;
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
}

export interface UpdatePositionPayload {
  symbol?: string;
  quantity?: number;
  cost_price?: number;
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
}
