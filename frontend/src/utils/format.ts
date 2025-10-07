const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF",
  CAD: "C$",
  AUD: "A$",
  HKD: "HK$",
  CNY: "¥",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
};

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const upper = (currency || "").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[upper];
  const formatted = formatNumber(value, digits);
  if (symbol) {
    return `${symbol}${formatted}`;
  }
  return upper ? `${formatted} ${upper}` : formatted;
}

export function formatSignedPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value >= 0 ? "+" : ""}${formatNumber(value, digits)}%`;
}

export function parsePrice(input: string): number | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
