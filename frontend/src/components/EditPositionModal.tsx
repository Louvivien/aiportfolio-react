import { FormEvent, useEffect, useState } from "react";
import type { Position, UpdatePositionPayload } from "../api/types";
import { parsePrice, toDateInputValue } from "../utils/format";
import { TagInput } from "./TagInput";

interface EditPositionModalProps {
  position: Position | null;
  onClose: () => void;
  onSubmit: (id: string, payload: UpdatePositionPayload) => Promise<void>;
  loading?: boolean;
  tagSuggestions: string[];
}

interface EditState {
  symbol: string;
  displayName: string;
  isCustomApi: boolean;
  apiUrl: string;
  apiToken: string;
  quantity: string;
  costPrice: string;
  isClosed: boolean;
  closingPrice: string;
  closingDate: string;
  tags: string[];
  purchaseDate: string;
  forumUrl: string;
  revenueGrowth: string;
  peRatio: string;
  pegRatio: string;
  roe5yAvg: string;
  quickRatio: string;
  indicatorDisabled: boolean;
}

const EMPTY_STATE: EditState = {
  symbol: "",
  displayName: "",
  isCustomApi: false,
  apiUrl: "",
  apiToken: "",
  quantity: "",
  costPrice: "",
  isClosed: false,
  closingPrice: "",
  closingDate: "",
  tags: [],
  purchaseDate: "",
  forumUrl: "",
  revenueGrowth: "",
  peRatio: "",
  pegRatio: "",
  roe5yAvg: "",
  quickRatio: "",
  indicatorDisabled: false,
};

export function EditPositionModal({
  position,
  onClose,
  onSubmit,
  loading = false,
  tagSuggestions,
}: EditPositionModalProps) {
  const [state, setState] = useState<EditState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [showApiToken, setShowApiToken] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!position) {
      setState(EMPTY_STATE);
      return;
    }
    const isCustomApi = Boolean(position.api_url);
    setState({
      symbol: position.symbol,
      displayName: position.display_name ?? "",
      isCustomApi,
      apiUrl: position.api_url ?? "",
      apiToken: "",
      quantity: String(position.quantity ?? ""),
      costPrice: String(position.cost_price ?? ""),
      isClosed: position.is_closed ?? false,
      closingPrice:
        position.closing_price === null || position.closing_price === undefined
          ? ""
          : String(position.closing_price),
      closingDate: (position.is_closed ?? false)
        ? toDateInputValue(position.closing_date ?? position.updated_at ?? null)
        : "",
      tags: Array.isArray(position.tags) ? position.tags : [],
      purchaseDate: toDateInputValue(position.purchase_date ?? position.created_at ?? null),
      forumUrl: position.boursorama_forum_url ?? "",
      revenueGrowth:
        position.revenue_growth_yoy_pct === null || position.revenue_growth_yoy_pct === undefined
          ? ""
          : String(position.revenue_growth_yoy_pct),
      peRatio:
        position.pe_ratio === null || position.pe_ratio === undefined
          ? ""
          : String(position.pe_ratio),
      pegRatio:
        position.peg_ratio === null || position.peg_ratio === undefined
          ? ""
          : String(position.peg_ratio),
      roe5yAvg:
        position.roe_5y_avg_pct === null || position.roe_5y_avg_pct === undefined
          ? ""
          : String(position.roe_5y_avg_pct),
      quickRatio:
        position.quick_ratio === null || position.quick_ratio === undefined
          ? ""
          : String(position.quick_ratio),
      indicatorDisabled: isCustomApi ? true : Boolean(position.indicator_disabled),
    });
    setShowApiToken(false);
  }, [position]);

  if (!position) {
    return null;
  }

  const updateState = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const handleToggleClosed = (checked: boolean) => {
    setState((prev) => ({
      ...prev,
      isClosed: checked,
      closingPrice: checked ? prev.closingPrice : "",
      closingDate: checked ? prev.closingDate || today : "",
    }));
  };

  const handleToggleCustomApi = (checked: boolean) => {
    setState((prev) => ({
      ...prev,
      isCustomApi: checked,
      indicatorDisabled: checked ? true : prev.indicatorDisabled,
      apiUrl: checked ? prev.apiUrl : "",
      apiToken: "",
      forumUrl: checked ? "" : prev.forumUrl,
    }));
    setShowApiToken(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!position.id) {
      setError("Missing position identifier.");
      return;
    }

    if (!state.symbol.trim()) {
      setError("Symbol is required.");
      return;
    }

    const qty = Number(state.quantity);
    const cost = Number(state.costPrice);

    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError("Cost price must be zero or greater.");
      return;
    }

    const apiUrl = state.isCustomApi ? state.apiUrl.trim() : "";
    const apiToken = state.apiToken.trim();
    const displayName = state.displayName.trim();
    if (state.isCustomApi && !apiUrl) {
      setError("API URL is required for a custom API position.");
      return;
    }

    let closingValue: number | null | undefined = undefined;
    let closingDate: string | null = null;
    if (state.isClosed) {
      closingValue = parsePrice(state.closingPrice);
      if (closingValue === null) {
        setError("Closing price must be a valid number.");
        return;
      }
      if (!state.closingDate) {
        setError("Closing date is required for closed positions.");
        return;
      }
      closingDate = state.closingDate;
    } else {
      closingValue = null;
    }

    const forumUrlInput = state.forumUrl.trim();
    const forumUrl = state.isCustomApi ? "" : forumUrlInput;

    const numbersEqual = (left: number | null, right: number | null) => {
      if (left === null || left === undefined) {
        return right === null || right === undefined;
      }
      if (right === null || right === undefined) {
        return false;
      }
      return Math.abs(left - right) < 1e-9;
    };

    const payload: UpdatePositionPayload = {
      symbol: state.symbol.toUpperCase().trim(),
      quantity: qty,
      cost_price: cost,
      is_closed: state.isClosed,
      closing_price: closingValue,
      closing_date: closingDate,
      tags: state.tags,
      purchase_date: state.purchaseDate ? state.purchaseDate : null,
      boursorama_forum_url: forumUrl ? forumUrl : null,
      indicator_disabled: state.isCustomApi ? true : state.indicatorDisabled,
    };

    const nextDisplayName = displayName ? displayName : null;
    const prevDisplayName = position.display_name ?? null;
    if (nextDisplayName !== prevDisplayName) {
      payload.display_name = nextDisplayName;
    }

    if (state.isCustomApi) {
      const prevUrl = position.api_url ?? null;
      if (apiUrl !== prevUrl) {
        payload.api_url = apiUrl;
      }
      if (apiToken) {
        payload.api_token = apiToken;
      }
    } else if (position.api_url) {
      payload.api_url = null;
      payload.api_token = null;
    }

    if (!state.isCustomApi) {
      const nextRevenueGrowth = parsePrice(state.revenueGrowth);
      if (!numbersEqual(nextRevenueGrowth, position.revenue_growth_yoy_pct ?? null)) {
        payload.revenue_growth_yoy_pct = nextRevenueGrowth;
      }

      const nextPeRatio = parsePrice(state.peRatio);
      if (!numbersEqual(nextPeRatio, position.pe_ratio ?? null)) {
        payload.pe_ratio = nextPeRatio;
      }

      const nextPegRatio = parsePrice(state.pegRatio);
      if (!numbersEqual(nextPegRatio, position.peg_ratio ?? null)) {
        payload.peg_ratio = nextPegRatio;
      }

      const nextRoe5yAvg = parsePrice(state.roe5yAvg);
      if (!numbersEqual(nextRoe5yAvg, position.roe_5y_avg_pct ?? null)) {
        payload.roe_5y_avg_pct = nextRoe5yAvg;
      }

      const nextQuickRatio = parsePrice(state.quickRatio);
      if (!numbersEqual(nextQuickRatio, position.quick_ratio ?? null)) {
        payload.quick_ratio = nextQuickRatio;
      }
    }

    try {
      await onSubmit(position.id, payload);
      onClose();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update position. Please try again.");
      }
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="section-header">
          <h3>Edit Position</h3>
          <button type="button" className="btn ghost" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="input-row">
            <label
              htmlFor="edit-custom-api"
              className="checkbox-row"
              style={{ justifyContent: "flex-start" }}
            >
              <input
                id="edit-custom-api"
                type="checkbox"
                checked={state.isCustomApi}
                onChange={(event) => handleToggleCustomApi(event.target.checked)}
                disabled={loading}
              />
              Custom API position
            </label>
            {state.isCustomApi && (
              <p className="muted" style={{ marginTop: 6 }}>
                Indicator is automatically disabled for custom API positions.
              </p>
            )}
          </div>

          {state.isCustomApi && (
            <div className="grid two">
              <div className="input-row">
                <label htmlFor="edit-display-name">Display name</label>
                <input
                  id="edit-display-name"
                  value={state.displayName}
                  onChange={(event) => updateState("displayName", event.target.value)}
                  placeholder="e.g. Mean Reversion (real money)"
                  disabled={loading}
                />
              </div>
              <div className="input-row">
                <label htmlFor="edit-api-url">API URL</label>
                <input
                  id="edit-api-url"
                  type="url"
                  inputMode="url"
                  value={state.apiUrl}
                  onChange={(event) => updateState("apiUrl", event.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="input-row">
                <label htmlFor="edit-api-token">JWT (x-auth-token)</label>
                <input
                  id="edit-api-token"
                  type={showApiToken ? "text" : "password"}
                  value={state.apiToken}
                  onChange={(event) => updateState("apiToken", event.target.value)}
                  placeholder="Leave blank to keep the stored JWT"
                  autoComplete="off"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="btn secondary"
                  style={{ marginTop: 8, width: "fit-content" }}
                  onClick={() => setShowApiToken((prev) => !prev)}
                  disabled={loading || !state.apiToken}
                >
                  {showApiToken ? "Hide JWT" : "Show JWT"}
                </button>
              </div>
            </div>
          )}

          <div className="grid two">
            <div className="input-row">
              <label htmlFor="edit-symbol">Ticker Symbol</label>
              <input
                id="edit-symbol"
                value={state.symbol}
                onChange={(event) => updateState("symbol", event.target.value)}
                autoCapitalize="characters"
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="edit-quantity">Quantity</label>
              <input
                id="edit-quantity"
                type="number"
                min="0"
                step="any"
                value={state.quantity}
                onChange={(event) => updateState("quantity", event.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="edit-cost">Cost Price</label>
              <input
                id="edit-cost"
                type="number"
                min="0"
                step="0.01"
                value={state.costPrice}
                onChange={(event) => updateState("costPrice", event.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="edit-purchase-date">Purchase Date</label>
              <input
                id="edit-purchase-date"
                type="date"
                value={state.purchaseDate}
                max={today}
                onChange={(event) => updateState("purchaseDate", event.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label className="checkbox-row" htmlFor="edit-closed">
                <input
                  id="edit-closed"
                  type="checkbox"
                  checked={state.isClosed}
                  onChange={(event) => handleToggleClosed(event.target.checked)}
                  disabled={loading}
                />
                Closed position
              </label>
              {state.isClosed && (
                <>
                  <label htmlFor="edit-closing-price">Closing Price</label>
                  <input
                    id="edit-closing-price"
                    type="text"
                    placeholder="28,09 or 28.09"
                    value={state.closingPrice}
                    onChange={(event) => updateState("closingPrice", event.target.value)}
                    disabled={loading}
                  />
                  <label htmlFor="edit-closing-date">Closing Date</label>
                  <input
                    id="edit-closing-date"
                    type="date"
                    value={state.closingDate}
                    max={today}
                    onChange={(event) => updateState("closingDate", event.target.value)}
                    disabled={loading}
                  />
                </>
              )}
            </div>
          </div>

          {!state.isCustomApi && (
            <div className="input-row">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 600 }}>Stock indicator inputs</span>
              <label className="checkbox-row" htmlFor="edit-indicator-disabled">
                <input
                  id="edit-indicator-disabled"
                  type="checkbox"
                  checked={state.indicatorDisabled}
                  onChange={(event) => updateState("indicatorDisabled", event.target.checked)}
                  disabled={loading}
                />
                Disable indicator (useful for ETFs)
              </label>
            </div>
            <div className="grid two" style={{ marginTop: 8 }}>
              <div className="input-row">
                <label htmlFor="edit-revenue-growth">Revenue growth YoY (%)</label>
                <input
                  id="edit-revenue-growth"
                  type="number"
                  step="0.01"
                  value={state.revenueGrowth}
                  onChange={(event) => updateState("revenueGrowth", event.target.value)}
                  placeholder="e.g. 12.5"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="edit-pe-ratio">P/E ratio</label>
                <input
                  id="edit-pe-ratio"
                  type="number"
                  step="0.01"
                  value={state.peRatio}
                  onChange={(event) => updateState("peRatio", event.target.value)}
                  placeholder="e.g. 18.4"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="edit-peg-ratio">PEG ratio</label>
                <input
                  id="edit-peg-ratio"
                  type="number"
                  step="0.01"
                  value={state.pegRatio}
                  onChange={(event) => updateState("pegRatio", event.target.value)}
                  placeholder="e.g. 1.3"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="edit-roe-avg">ROE 5-year avg (%)</label>
                <input
                  id="edit-roe-avg"
                  type="number"
                  step="0.01"
                  value={state.roe5yAvg}
                  onChange={(event) => updateState("roe5yAvg", event.target.value)}
                  placeholder="e.g. 8.2"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="edit-quick-ratio">Quick ratio</label>
                <input
                  id="edit-quick-ratio"
                  type="number"
                  step="0.01"
                  value={state.quickRatio}
                  onChange={(event) => updateState("quickRatio", event.target.value)}
                  placeholder="e.g. 1.8"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Leave blank to keep missing; clear a field to remove its stored value.
            </p>
            </div>
          )}

          <div className="input-row">
            <label>Tags</label>
            <TagInput
              value={state.tags}
              onChange={(tags) => updateState("tags", tags)}
              suggestions={tagSuggestions}
              placeholder="Press enter to add tag"
            />
          </div>

          {!state.isCustomApi && (
            <div className="input-row">
              <label htmlFor="edit-boursorama-url">Boursorama forum URL</label>
              <input
                id="edit-boursorama-url"
                type="url"
                inputMode="url"
                value={state.forumUrl}
                onChange={(event) => updateState("forumUrl", event.target.value)}
                placeholder="https://www.boursorama.com/bourse/forum/..."
                disabled={loading}
              />
              <p className="muted" style={{ marginTop: 4 }}>
                Leave blank to auto-detect from the symbol.
              </p>
            </div>
          )}

          {error && <div className="error-text">{error}</div>}

          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="btn secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditPositionModal;
