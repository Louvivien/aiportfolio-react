import { FormEvent, useState } from "react";
import type { CreatePositionPayload } from "../api/types";
import { parsePrice } from "../utils/format";
import { TagInput } from "./TagInput";

interface AddPositionFormProps {
  onCreate: (payload: CreatePositionPayload) => Promise<void>;
  loading?: boolean;
  tagSuggestions: string[];
}

const INITIAL_STATE = {
  symbol: "",
  quantity: "",
  costPrice: "",
  closingPrice: "",
  isClosed: false,
  tags: [] as string[],
};

type FormState = typeof INITIAL_STATE;

export function AddPositionForm({ onCreate, loading = false, tagSuggestions }: AddPositionFormProps) {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const reset = () => {
    setState(INITIAL_STATE);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!state.symbol.trim()) {
      setError("Symbol is required.");
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
    if (state.isClosed) {
      closingValue = parsePrice(state.closingPrice);
      if (closingValue === null) {
        setError("Provide a valid closing price for closed positions.");
        return;
      }
    }

    const payload: CreatePositionPayload = {
      symbol: state.symbol.toUpperCase().trim(),
      quantity,
      cost_price: cost,
      tags: state.tags,
      is_closed: state.isClosed,
      closing_price: closingValue,
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
          <div className="grid two">
            <div className="input-row">
              <label htmlFor="add-symbol">Ticker Symbol</label>
              <input
                id="add-symbol"
                value={state.symbol}
                onChange={(event) => updateField("symbol", event.target.value)}
                placeholder="AAPL"
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
              <label htmlFor="add-closed" className="checkbox-row">
                <input
                  id="add-closed"
                  type="checkbox"
                  checked={state.isClosed}
                  onChange={(event) => updateField("isClosed", event.target.checked)}
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
                </>
              )}
            </div>
          </div>

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
