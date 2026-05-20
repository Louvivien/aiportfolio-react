import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNewsAgenda } from "../api/client";
import type {
  NewsAgendaResponse,
  PortfolioAgendaItem,
  PortfolioNewsItem,
  Position,
} from "../api/types";

interface NewsAgendaPanelProps {
  positions: Position[];
  loading?: boolean;
}

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeAxios = error as { response?: { data?: { detail?: string } }; message?: string };
    if (typeof maybeAxios.response?.data?.detail === "string") {
      return maybeAxios.response.data.detail;
    }
    if (typeof maybeAxios.message === "string") {
      return maybeAxios.message;
    }
  }
  return "Could not load news and agenda.";
};

const symbolList = (symbols: string[]) => symbols.slice(0, 4).join(", ");

const formatFrenchDate = (value: string, options: Intl.DateTimeFormatOptions) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("fr-FR", options);
};

const formatNewsDate = (value: string) =>
  formatFrenchDate(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatAgendaDate = (value: string) =>
  formatFrenchDate(value, { year: "numeric", month: "short", day: "numeric" });

const formatAgendaRange = (item: PortfolioAgendaItem) => {
  const dateLabel = item.end_date
    ? `${formatAgendaDate(item.date)} - ${formatAgendaDate(item.end_date)}`
    : formatAgendaDate(item.date);
  return item.time_label ? `${dateLabel} · ${item.time_label}` : dateLabel;
};

const formatEventType = (value: string) => {
  switch (value) {
    case "earnings":
      return "resultats";
    case "earnings_call":
      return "presentation resultats";
    case "sales_update":
      return "activite";
    case "ex_dividend":
      return "ex-dividende";
    case "dividend":
      return "paiement dividende";
    case "annual_meeting":
      return "assemblee annuelle";
    case "shareholder_meeting":
      return "assemblee";
    case "shareholder_presentation":
      return "actionnaires";
    case "board_meeting":
      return "conseil";
    case "investor_day":
      return "investisseurs";
    default:
      return value.replace(/_/g, " ");
  }
};

function NewsItem({ item }: { item: PortfolioNewsItem }) {
  return (
    <article className="news-agenda-item">
      <div className="news-agenda-item-head">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          <span>{item.title}</span>
        )}
        <time dateTime={item.date}>{formatNewsDate(item.date)}</time>
      </div>
      <div className="news-agenda-meta">
        {item.publisher && <span>{item.publisher}</span>}
        <span>{symbolList(item.symbols)}</span>
      </div>
    </article>
  );
}

function AgendaItem({ item }: { item: PortfolioAgendaItem }) {
  const details = (item.details ?? []).filter(
    (detail) => !detail.trim().toLowerCase().startsWith("société:"),
  );

  return (
    <article className="news-agenda-item news-agenda-event">
      <div className="news-agenda-item-head">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          <span>{item.title}</span>
        )}
        <time dateTime={item.date}>{formatAgendaRange(item)}</time>
      </div>
      <div className="news-agenda-meta">
        <span>{formatEventType(item.event_type)}</span>
        <span>{symbolList(item.symbols)}</span>
        {item.company_name && <span>{item.company_name}</span>}
        {item.source && <span>{item.source}</span>}
      </div>
      {details.length > 0 && (
        <ul className="news-agenda-details">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function NewsAgendaPanel({ positions, loading: portfolioLoading = false }: NewsAgendaPanelProps) {
  const [data, setData] = useState<NewsAgendaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");

  const activeStockSymbols = useMemo(() => {
    return Array.from(
      new Set(
        positions
          .filter((position) => !position.api_url && !position.is_closed)
          .map((position) => position.symbol?.toUpperCase().trim())
          .filter((symbol): symbol is string => Boolean(symbol)),
      ),
    ).sort();
  }, [positions]);

  const symbolsKey = activeStockSymbols.join("|");
  const hasActiveStocks = activeStockSymbols.length > 0;

  const stockLabelsBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    positions.forEach((position) => {
      const symbol = position.symbol?.toUpperCase().trim();
      if (!symbol) {
        return;
      }
      const label = position.display_name || position.long_name || symbol;
      map.set(symbol, label);
    });
    return map;
  }, [positions]);

  const loadNewsAgenda = useCallback(async () => {
    if (portfolioLoading) {
      return;
    }
    if (!symbolsKey) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetchNewsAgenda();
      setData(response);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [portfolioLoading, symbolsKey]);

  useEffect(() => {
    void loadNewsAgenda();
  }, [loadNewsAgenda]);

  const normalizedFilter = filterText.trim().toLowerCase();
  const matchesFilter = useCallback(
    (item: PortfolioNewsItem | PortfolioAgendaItem) => {
      if (!normalizedFilter) {
        return true;
      }
      const haystack = [
        item.title,
        ...item.symbols,
        ...item.symbols.map((symbol) => stockLabelsBySymbol.get(symbol) ?? ""),
        "company_name" in item ? item.company_name ?? "" : "",
        "source" in item ? item.source ?? "" : "",
        "time_label" in item ? item.time_label ?? "" : "",
        "details" in item ? (item.details ?? []).join(" ") : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedFilter);
    },
    [normalizedFilter, stockLabelsBySymbol],
  );

  const news = useMemo(() => (data?.news ?? []).filter(matchesFilter), [data?.news, matchesFilter]);
  const agenda = useMemo(
    () => (data?.agenda ?? []).filter(matchesFilter),
    [data?.agenda, matchesFilter],
  );
  const refreshedAt = data?.generated_at ? formatNewsDate(data.generated_at) : null;

  return (
    <div className="card news-agenda-card">
      <div className="section-header">
        <div>
          <h2>Actualités &amp; Agenda</h2>
          {refreshedAt && <p className="news-agenda-refresh">Mis à jour {refreshedAt}</p>}
        </div>
        <button
          type="button"
          className="btn secondary"
          onClick={loadNewsAgenda}
          disabled={portfolioLoading || loading || !hasActiveStocks}
        >
          {loading ? "Actualisation..." : "Actualiser"}
        </button>
      </div>

      {portfolioLoading ? (
        <div className="loading">Chargement du portefeuille...</div>
      ) : !hasActiveStocks ? (
        <div className="empty-state news-agenda-empty">Aucune action active à suivre.</div>
      ) : error ? (
        <div className="news-agenda-error">
          <span>{error}</span>
          <button type="button" className="btn secondary" onClick={loadNewsAgenda}>
            Reessayer
          </button>
        </div>
      ) : loading && !data ? (
        <div className="loading">Chargement des actualités et de l'agenda...</div>
      ) : (
        <div className="news-agenda-content">
          <div className="news-agenda-filter">
            <label htmlFor="news-agenda-filter">Filtrer</label>
            <input
              id="news-agenda-filter"
              type="search"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="Nom de l'action ou ticker"
            />
          </div>

          <div className="news-agenda-grid">
            <section className="news-agenda-column">
              <div className="news-agenda-column-head">
                <h3>Actualités récentes</h3>
                <span>{news.length}</span>
              </div>
              {news.length ? (
                <div className="news-agenda-list">
                  {news.map((item) => (
                    <NewsItem key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <div className="empty-state news-agenda-empty">
                  Aucune actualité récente trouvée.
                </div>
              )}
            </section>

            <section className="news-agenda-column">
              <div className="news-agenda-column-head">
                <h3>Agenda</h3>
                <span>{agenda.length}</span>
              </div>
              {agenda.length ? (
                <div className="news-agenda-list">
                  {agenda.map((item) => (
                    <AgendaItem key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <div className="empty-state news-agenda-empty">Aucune date à venir trouvée.</div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default NewsAgendaPanel;
