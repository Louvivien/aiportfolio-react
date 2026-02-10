import { FormEvent, useState } from "react";
import type { CreatePositionPayload } from "../api/types";
import { parsePrice } from "../utils/format";
import { parseAiPortfolioIntegrationLink } from "../utils/integration";
import { TagInput } from "./TagInput";

interface AddPositionFormProps {
  onCreate: (payload: CreatePositionPayload) => Promise<void>;
  loading?: boolean;
  tagSuggestions: string[];
}

const INITIAL_STATE = {
  symbol: "",
  displayName: "",
  quantity: "",
  costPrice: "",
  isCustomApi: false,
  integrationLink: "",
  apiUrl: "",
  apiToken: "",
  closingPrice: "",
  closingDate: "",
  isClosed: false,
  tags: [] as string[],
  purchaseDate: "",
  revenueGrowth: "",
  peRatio: "",
  pegRatio: "",
  roe5yAvg: "",
  quickRatio: "",
  indicatorDisabled: false,
};

type FormState = typeof INITIAL_STATE;

export function AddPositionForm({ onCreate, loading = false, tagSuggestions }: AddPositionFormProps) {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const handleToggleClosed = (checked: boolean) => {
    setState((prev) => ({
      ...prev,
      isClosed: checked,
      closingPrice: checked ? prev.closingPrice : "",
      closingDate: checked ? prev.closingDate || today : "",
    }));
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const reset = () => {
    setState(INITIAL_STATE);
    setError(null);
    setShowApiToken(false);
  };

  const handleToggleCustomApi = (checked: boolean) => {
    setState((prev) => ({
      ...prev,
      isCustomApi: checked,
      indicatorDisabled: checked ? true : false,
      integrationLink: checked ? prev.integrationLink : "",
      displayName: checked ? prev.displayName : "",
      apiUrl: checked ? prev.apiUrl : "",
      apiToken: checked ? prev.apiToken : "",
    }));
  };

  const handleApplyIntegrationLink = () => {
    setError(null);
    const parsed = parseAiPortfolioIntegrationLink(state.integrationLink);
    if (!parsed) {
      setError("Invalid integration link. Copy it again from TradingApp and try pasting it here.");
      return;
    }

    setState((prev) => ({
      ...prev,
      isCustomApi: true,
      indicatorDisabled: true,
      symbol: parsed.symbol ? parsed.symbol.toUpperCase().trim() : prev.symbol,
      quantity: parsed.quantity !== undefined ? String(parsed.quantity) : prev.quantity,
      costPrice: parsed.cost_price !== undefined ? String(parsed.cost_price) : prev.costPrice,
      tags: parsed.tags ? parsed.tags : prev.tags,
      displayName: parsed.display_name ? parsed.display_name : prev.displayName,
      apiUrl: parsed.api_url ? parsed.api_url : prev.apiUrl,
      apiToken: parsed.api_token ? parsed.api_token : prev.apiToken,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!state.symbol.trim()) {
      setError("Symbol is required.");
      return;
    }

    const apiUrl = state.isCustomApi ? state.apiUrl.trim() : "";
    const apiToken = state.isCustomApi ? state.apiToken.trim() : "";
    const displayName = state.displayName.trim();
    if (state.isCustomApi && !apiUrl) {
      setError("API URL is required for a custom API position.");
      return;
    }

    const quantity = Number(state.quantity);
    const cost = Number(state.costPrice);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }

    if (!Number.isFinite(cost) || cost < 0) {
      setError("Cost price must be zero or greater.");
      return;
    }

    let closingValue: number | null = null;
    let closingDate: string | null = null;
    if (state.isClosed) {
      closingValue = parsePrice(state.closingPrice);
      if (closingValue === null) {
        setError("Provide a valid closing price for closed positions.");
        return;
      }
      if (!state.closingDate) {
        setError("Provide a closing date for closed positions.");
        return;
      }
      closingDate = state.closingDate;
    }

    const payload: CreatePositionPayload = {
      symbol: state.symbol.toUpperCase().trim(),
      display_name: state.isCustomApi ? (displayName ? displayName : null) : undefined,
      api_url: state.isCustomApi ? apiUrl : undefined,
      api_token: state.isCustomApi ? (apiToken ? apiToken : null) : undefined,
      quantity,
      cost_price: cost,
      tags: state.tags,
      is_closed: state.isClosed,
      closing_price: closingValue,
      closing_date: closingDate,
      purchase_date: state.purchaseDate || undefined,
      revenue_growth_yoy_pct: state.isCustomApi ? undefined : parsePrice(state.revenueGrowth),
      pe_ratio: state.isCustomApi ? undefined : parsePrice(state.peRatio),
      peg_ratio: state.isCustomApi ? undefined : parsePrice(state.pegRatio),
      roe_5y_avg_pct: state.isCustomApi ? undefined : parsePrice(state.roe5yAvg),
      quick_ratio: state.isCustomApi ? undefined : parsePrice(state.quickRatio),
      indicator_disabled: state.isCustomApi ? true : state.indicatorDisabled,
    };

    await onCreate(payload);
    reset();
  };

  return (
    <div className="card">
      <div className="section-header">
        <h2>➕ Add Position</h2>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "Hide form" : "Add new"}
        </button>
      </div>
      {open ? (
        <form onSubmit={handleSubmit} className="form-grid" autoComplete="off">
          <div className="input-row">
            <label htmlFor="add-custom-api" className="checkbox-row" style={{ justifyContent: "flex-start" }}>
              <input
                id="add-custom-api"
                type="checkbox"
                checked={state.isCustomApi}
                onChange={(event) => handleToggleCustomApi(event.target.checked)}
                disabled={loading}
              />
              Custom API position (TradingApp strategy, Polymarket, etc.)
            </label>
            {state.isCustomApi && (
              <p className="muted" style={{ marginTop: 6 }}>
                This will store your JWT and send it to the API URL via the <code>x-auth-token</code> header.
                Only use links from sources you trust.
              </p>
            )}
          </div>

          {state.isCustomApi && (
            <div className="input-row">
              <label htmlFor="add-integration-link">TradingApp / aiportfolio link</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  id="add-integration-link"
                  value={state.integrationLink}
                  onChange={(event) => updateField("integrationLink", event.target.value)}
                  placeholder="aiportfolio://api-position?symbol=...&api_url=...&api_token=..."
                  disabled={loading}
                  style={{ flex: 1, minWidth: 240 }}
                />
                <button
                  type="button"
                  className="btn secondary"
                  onClick={handleApplyIntegrationLink}
                  disabled={loading || !state.integrationLink.trim()}
                >
                  Apply link
                </button>
              </div>
              <p className="muted" style={{ marginTop: 6 }}>
                In TradingApp click <strong>AI Portfolio</strong> on your strategy row to copy this link.
              </p>
            </div>
          )}

          {state.isCustomApi && (
            <div className="grid two">
              <div className="input-row">
                <label htmlFor="add-display-name">Display name</label>
                <input
                  id="add-display-name"
                  value={state.displayName}
                  onChange={(event) => updateField("displayName", event.target.value)}
                  placeholder="e.g. Mean Reversion (real money)"
                  disabled={loading}
                />
              </div>
              <div className="input-row">
                <label htmlFor="add-api-url">API URL</label>
                <input
                  id="add-api-url"
                  type="url"
                  inputMode="url"
                  value={state.apiUrl}
                  onChange={(event) => updateField("apiUrl", event.target.value)}
                  placeholder="https://your-tradingapp/api/strategies/equity/..."
                  disabled={loading}
                />
              </div>
              <div className="input-row">
                <label htmlFor="add-api-token">JWT (x-auth-token)</label>
                <input
                  id="add-api-token"
                  type={showApiToken ? "text" : "password"}
                  value={state.apiToken}
                  onChange={(event) => updateField("apiToken", event.target.value)}
                  placeholder="Paste the JWT from TradingApp settings"
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
              <label htmlFor="add-symbol">Ticker Symbol</label>
              <input
                id="add-symbol"
                value={state.symbol}
                onChange={(event) => updateField("symbol", event.target.value)}
                placeholder={state.isCustomApi ? "STRAT_1234" : "AAPL"}
                autoCapitalize="characters"
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="add-quantity">Quantity</label>
              <input
                id="add-quantity"
                type="number"
                min="0"
                step="any"
                value={state.quantity}
                onChange={(event) => updateField("quantity", event.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="add-cost">Cost Price</label>
              <input
                id="add-cost"
                type="number"
                min="0"
                step="0.01"
                value={state.costPrice}
                onChange={(event) => updateField("costPrice", event.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="add-purchase-date">Purchase Date</label>
              <input
                id="add-purchase-date"
                type="date"
                value={state.purchaseDate}
                max={today}
                onChange={(event) => updateField("purchaseDate", event.target.value)}
                disabled={loading}
              />
            </div>
            <div className="input-row">
              <label htmlFor="add-closed" className="checkbox-row">
                <input
                  id="add-closed"
                  type="checkbox"
                  checked={state.isClosed}
                  onChange={(event) => handleToggleClosed(event.target.checked)}
                  disabled={loading}
                />
                Mark as closed
              </label>
              {state.isClosed && (
                <>
                  <label htmlFor="add-closing-price">Closing Price</label>
                  <input
                    id="add-closing-price"
                    type="text"
                    placeholder="28,09 or 28.09"
                    value={state.closingPrice}
                    onChange={(event) => updateField("closingPrice", event.target.value)}
                    disabled={loading}
                  />
                  <label htmlFor="add-closing-date">Closing Date</label>
                  <input
                    id="add-closing-date"
                    type="date"
                    value={state.closingDate}
                    max={today}
                    onChange={(event) => updateField("closingDate", event.target.value)}
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
              <label className="checkbox-row" htmlFor="add-indicator-disabled">
                <input
                  id="add-indicator-disabled"
                  type="checkbox"
                  checked={state.indicatorDisabled}
                  onChange={(event) => updateField("indicatorDisabled", event.target.checked)}
                  disabled={loading}
                />
                Disable indicator for this position
              </label>
            </div>
            <div className="grid two" style={{ marginTop: 8 }}>
              <div className="input-row">
                <label htmlFor="add-revenue-growth">Revenue growth YoY (%)</label>
                <input
                  id="add-revenue-growth"
                  type="number"
                  step="0.01"
                  value={state.revenueGrowth}
                  onChange={(event) => updateField("revenueGrowth", event.target.value)}
                  placeholder="e.g. 12.5"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="add-pe-ratio">P/E ratio</label>
                <input
                  id="add-pe-ratio"
                  type="number"
                  step="0.01"
                  value={state.peRatio}
                  onChange={(event) => updateField("peRatio", event.target.value)}
                  placeholder="e.g. 18.4"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="add-peg-ratio">PEG ratio</label>
                <input
                  id="add-peg-ratio"
                  type="number"
                  step="0.01"
                  value={state.pegRatio}
                  onChange={(event) => updateField("pegRatio", event.target.value)}
                  placeholder="e.g. 1.3"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="add-roe-avg">ROE 5-year avg (%)</label>
                <input
                  id="add-roe-avg"
                  type="number"
                  step="0.01"
                  value={state.roe5yAvg}
                  onChange={(event) => updateField("roe5yAvg", event.target.value)}
                  placeholder="e.g. 8.2"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
              <div className="input-row">
                <label htmlFor="add-quick-ratio">Quick ratio</label>
                <input
                  id="add-quick-ratio"
                  type="number"
                  step="0.01"
                  value={state.quickRatio}
                  onChange={(event) => updateField("quickRatio", event.target.value)}
                  placeholder="e.g. 1.8"
                  disabled={loading || state.indicatorDisabled}
                />
              </div>
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              Leave blank if the data is missing; the indicator will show a warning when inputs are incomplete.
            </p>
            </div>
          )}

          <div className="input-row">
            <label>Tags</label>
            <TagInput
              value={state.tags}
              onChange={(tags) => updateField("tags", tags)}
              suggestions={tagSuggestions}
              placeholder="Press enter to add tag"
            />
          </div>

          {error && <div className="error-text">{error}</div>}

          <div>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Adding…" : "Add Position"}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          Click “Add new” to open the form.
        </p>
      )}
    </div>
  );
}

export default AddPositionForm;
