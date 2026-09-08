import axios from "axios";
import type { SaleRequest, SalePreview } from "./sales";
import type {
  CreatePositionPayload,
  ForumPostsResponse,
  MonthlyPerformanceReport,
  MonthlyReportsListResponse,
  NewsAgendaResponse,
  PortfolioSummary,
  Position,
  PurchaseLot,
  Tag,
  TagSummaryRow,
  TagTimeseriesResponse,
  TimeseriesPoint,
  UpdatePositionPayload,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

const client = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
});

const unwrap = <T>(promise: Promise<{ data: T }>): Promise<T> =>
  promise.then((response) => response.data);

const normalizeDateValue = (value: unknown): string | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const normalizePosition = (raw: Position): Position => {
  const id = raw.id ?? raw._id ?? raw.symbol;
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const purchase = normalizeDateValue(raw.purchase_date);
  const purchaseLots = Array.isArray(raw.purchase_lots)
    ? raw.purchase_lots
        .map((lot, index): PurchaseLot | null => {
          const quantity = Number(lot.quantity);
          const costPrice = Number(lot.cost_price);
          if (!Number.isFinite(quantity) || !Number.isFinite(costPrice)) {
            return null;
          }
          return {
            ...lot,
            id: lot.id ?? `lot-${index + 1}`,
            quantity,
            cost_price: costPrice,
            purchase_date: normalizeDateValue(lot.purchase_date),
            stop_loss_set: Boolean(lot.stop_loss_set),
            is_closed: Boolean(lot.is_closed),
            closing_price:
              lot.closing_price === null || lot.closing_price === undefined
                ? null
                : Number(lot.closing_price),
            closing_date: normalizeDateValue(lot.closing_date),
          };
        })
        .filter((lot): lot is PurchaseLot => lot !== null)
    : [];
  return {
    ...raw,
    id,
    tags,
    purchase_lots: purchaseLots,
    purchase_date: purchase,
    closing_date: normalizeDateValue(raw.closing_date),
    created_at: normalizeDateValue(raw.created_at),
    updated_at: normalizeDateValue(raw.updated_at),
    indicator_disabled: Boolean(raw.indicator_disabled),
    stop_loss_set: Boolean(raw.stop_loss_set),
  };
};

export function fetchPositions(): Promise<Position[]> {
  return unwrap(client.get<Position[]>("/positions")).then((data) =>
    (data || []).map(normalizePosition),
  );
}

export function fetchTags(): Promise<Tag[]> {
  return unwrap(client.get<Tag[]>("/tags"));
}

export function fetchPortfolioSummary(): Promise<PortfolioSummary> {
  return unwrap(client.get<PortfolioSummary>("/positions/summary"));
}

export function fetchTagSummary(): Promise<TagSummaryRow[]> {
  return unwrap(client.get<TagSummaryRow[]>("/positions/tags/summary"));
}

export function fetchTagTimeseries(
  period: string,
  interval: string,
): Promise<TagTimeseriesResponse> {
  return unwrap(
    client.get<TagTimeseriesResponse>("/positions/tags/timeseries", {
      params: { period, interval },
    }),
  );
}

export function fetchMonthlyReports(): Promise<MonthlyReportsListResponse> {
  return unwrap(client.get<MonthlyReportsListResponse>("/monthly-reports"));
}

export function fetchMonthlyReport(month: string): Promise<MonthlyPerformanceReport> {
  return unwrap(client.get<MonthlyPerformanceReport>(`/monthly-reports/${month}`, { timeout: 60000 }));
}

export function regenerateMonthlyReport(month: string): Promise<MonthlyPerformanceReport> {
  return unwrap(client.post<MonthlyPerformanceReport>(`/monthly-reports/${month}/regenerate`, undefined, { timeout: 60000 }));
}

export function createPosition(payload: CreatePositionPayload): Promise<Position> {
  return unwrap(client.post<Position>("/positions", payload)).then(normalizePosition);
}

export function updatePosition(id: string, payload: UpdatePositionPayload): Promise<Position> {
  return unwrap(client.put<Position>(`/positions/${id}`, payload)).then(normalizePosition);
}

export function sellPosition(id: string, payload: SaleRequest): Promise<{ ok: boolean; sale_id: string }> {
  return unwrap(client.post<{ ok: boolean; sale_id: string }>(`/positions/${id}/sales`, payload));
}

export async function previewPositionSale(id: string, payload: SaleRequest): Promise<SalePreview> {
  try { return await unwrap(client.post<SalePreview>(`/positions/${id}/sales/preview`, payload)); }
  catch (error) {
    const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'L’aperçu est indisponible. Réessaie dans un instant.');
  }
}

export function deletePosition(id: string): Promise<{ ok: boolean }> {
  return unwrap(client.delete<{ ok: boolean }>(`/positions/${id}`));
}

export function fetchForumPostsForPosition(id: string): Promise<ForumPostsResponse> {
  return unwrap(client.get<ForumPostsResponse>(`/positions/${id}/forum/posts`));
}

export function fetchNewsAgenda(): Promise<NewsAgendaResponse> {
  return unwrap(client.get<NewsAgendaResponse>("/positions/news-agenda"));
}

export type { TagTimeseriesResponse, TimeseriesPoint, ForumPostsResponse, NewsAgendaResponse };
