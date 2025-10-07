import { useMemo, useState, KeyboardEvent } from "react";
import classNames from "classnames";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}

export function TagInput({ value, onChange, suggestions = [], placeholder }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const normalizedCurrent = useMemo(
    () => value.map((tag) => tag.trim()).filter(Boolean),
    [value],
  );

  const normalizedSuggestions = useMemo(() => {
    const lower = new Set(normalizedCurrent.map((tag) => tag.toLowerCase()));
    const filtered = suggestions.filter((item) => !lower.has(item.toLowerCase()));
    if (!draft) {
      return filtered.slice(0, 6);
    }
    return filtered
      .filter((item) => item.toLowerCase().includes(draft.toLowerCase()))
      .slice(0, 6);
  }, [suggestions, normalizedCurrent, draft]);

  const commitDraft = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) {
      return;
    }
    const exists = normalizedCurrent.some((item) => item.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setDraft("");
      return;
    }
    onChange([...normalizedCurrent, trimmed]);
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
      event.preventDefault();
      commitDraft(draft);
    } else if (event.key === "Backspace" && !draft && normalizedCurrent.length) {
      event.preventDefault();
      const next = normalizedCurrent.slice(0, -1);
      onChange(next);
    }
  };

  const removeTag = (tag: string) => {
    onChange(normalizedCurrent.filter((item) => item !== tag));
  };

  return (
    <div className="tag-input">
      <div className="tag-input-chips">
        {normalizedCurrent.map((tag) => (
          <button
            type="button"
            key={tag}
            className="tag-chip removable"
            onClick={() => removeTag(tag)}
            aria-label={`Remove tag ${tag}`}
          >
            {tag}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      </div>
      {normalizedSuggestions.length > 0 && (
        <div className="tag-input-suggestions">
          {normalizedSuggestions.map((tag) => (
            <button
              type="button"
              key={tag}
              className={classNames("tag-chip", "suggestion")}
              onClick={() => commitDraft(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TagInput;
