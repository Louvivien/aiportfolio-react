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
  closingDate: string;
  tags: string[];
  purchaseDate: string;
  forumUrl: string;
}

const EMPTY_STATE: EditState = {
  symbol: "",
  quantity: "",
  costPrice: "",
  isClosed: false,
  closingPrice: "",
  closingDate: "",
  tags: [],
  purchaseDate: "",
  forumUrl: "",
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
    });
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

    const payload: UpdatePositionPayload = {
      symbol: state.symbol.toUpperCase().trim(),
      quantity: qty,
      cost_price: cost,
      is_closed: state.isClosed,
      closing_price: closingValue,
      closing_date: closingDate,
      tags: state.tags,
      purchase_date: state.purchaseDate ? state.purchaseDate : null,
      boursorama_forum_url: forumUrlInput ? forumUrlInput : null,
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

          <div className="input-row">
            <label>Tags</label>
            <TagInput
              value={state.tags}
              onChange={(tags) => updateState("tags", tags)}
              suggestions={tagSuggestions}
              placeholder="Press enter to add tag"
            />
          </div>

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
