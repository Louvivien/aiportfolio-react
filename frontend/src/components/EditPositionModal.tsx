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
  quantity: string;
  costPrice: string;
  isClosed: boolean;
  closingPrice: string;
  tags: string[];
  purchaseDate: string;
}

const EMPTY_STATE: EditState = {
  symbol: "",
  quantity: "",
  costPrice: "",
  isClosed: false,
  closingPrice: "",
  tags: [],
  purchaseDate: "",
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
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!position) {
      setState(EMPTY_STATE);
      return;
    }
    setState({
      symbol: position.symbol,
      quantity: String(position.quantity ?? ""),
      costPrice: String(position.cost_price ?? ""),
      isClosed: Boolean(position.is_closed),
      closingPrice:
        position.closing_price === null || position.closing_price === undefined
          ? ""
          : String(position.closing_price),
      tags: Array.isArray(position.tags) ? position.tags : [],
      purchaseDate: toDateInputValue(position.purchase_date ?? position.created_at ?? null),
    });
  }, [position]);

  if (!position) {
    return null;
  }

  const updateState = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
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

    let closingValue: number | null | undefined = undefined;
    if (state.isClosed) {
      closingValue = parsePrice(state.closingPrice);
      if (closingValue === null) {
        setError("Closing price must be a valid number.");
        return;
      }
    } else {
      closingValue = null;
    }

    const payload: UpdatePositionPayload = {
      symbol: state.symbol.toUpperCase().trim(),
      quantity: qty,
      cost_price: cost,
      is_closed: state.isClosed,
      closing_price: closingValue,
      tags: state.tags,
      purchase_date: state.purchaseDate ? state.purchaseDate : null,
    };

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
                  onChange={(event) => updateState("isClosed", event.target.checked)}
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
                </>
              )}
            </div>
          </div>

          <div className="input-row">
            <label>Tags</label>
            <TagInput
              value={state.tags}
              onChange={(tags) => updateState("tags", tags)}
              suggestions={tagSuggestions}
              placeholder="Press enter to add tag"
            />
          </div>

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
