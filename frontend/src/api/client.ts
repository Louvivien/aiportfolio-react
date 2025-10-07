import axios from "axios";
import type {
  CreatePositionPayload,
  PortfolioSummary,
  Position,
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

const normalizePosition = (raw: Position): Position => {
  const id = raw.id ?? raw._id ?? raw.symbol;
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  return { ...raw, id, tags };
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

export function createPosition(payload: CreatePositionPayload): Promise<Position> {
  return unwrap(client.post<Position>("/positions", payload)).then(normalizePosition);
}

export function updatePosition(id: string, payload: UpdatePositionPayload): Promise<Position> {
  return unwrap(client.put<Position>(`/positions/${id}`, payload)).then(normalizePosition);
}

export function deletePosition(id: string): Promise<{ ok: boolean }> {
  return unwrap(client.delete<{ ok: boolean }>(`/positions/${id}`));
}

export type { TagTimeseriesResponse, TimeseriesPoint };
