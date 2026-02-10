export interface AiPortfolioIntegrationPayload {
  symbol?: string;
  display_name?: string;
  api_url?: string;
  api_token?: string;
  quantity?: number;
  cost_price?: number;
  tags?: string[];
  currency?: string;
}

const parseNumber = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : undefined;
};

export const parseAiPortfolioIntegrationLink = (raw: string): AiPortfolioIntegrationPayload | null => {
  const input = String(raw || "").trim();
  if (!input) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol.toLowerCase() !== "aiportfolio:") {
    return null;
  }

  const get = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = url.searchParams.get(key);
      if (value !== null) {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return null;
  };

  const symbol = get("symbol", "s");
  const displayName = get("display_name", "name", "n");
  const apiUrl = get("api_url", "url", "u");
  const apiToken = get("api_token", "token", "t");
  const currency = get("currency", "ccy");
  const quantity = parseNumber(get("quantity", "qty", "q"));
  const costPrice = parseNumber(get("cost_price", "cost", "cp"));
  const tagsRaw = get("tags");

  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : undefined;

  const payload: AiPortfolioIntegrationPayload = {};
  if (symbol) payload.symbol = symbol;
  if (displayName) payload.display_name = displayName;
  if (apiUrl) payload.api_url = apiUrl;
  if (apiToken) payload.api_token = apiToken;
  if (currency) payload.currency = currency;
  if (quantity !== undefined) payload.quantity = quantity;
  if (costPrice !== undefined) payload.cost_price = costPrice;
  if (tags && tags.length) payload.tags = tags;

  return Object.keys(payload).length ? payload : null;
};

