import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddPositionForm from "./components/AddPositionForm";
import EditPositionModal from "./components/EditPositionModal";
import PositionsTable, { SortConfig, SortableColumn } from "./components/PositionsTable";
import TagSummary from "./components/TagSummary";
import TimeseriesPanel from "./components/TimeseriesPanel";
import TotalsPanel from "./components/TotalsPanel";
import PositionsPie from "./components/PositionsPie";
import {
  createPosition,
  deletePosition,
  fetchPositions,
  fetchTagSummary,
  fetchTagTimeseries,
  fetchTags,
  updatePosition,
} from "./api/client";
import type {
  CreatePositionPayload,
  Position,
  Tag,
  TagSummaryRow,
  TagTimeseriesResponse,
  UpdatePositionPayload,
} from "./api/types";
import { buildPortfolioView } from "./utils/portfolio";

const defaultSortConfig: SortConfig = { column: "value", direction: "desc" };

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeAxios = error as { response?: { data?: { detail?: string; message?: string } }; message?: string };
    const detail = maybeAxios.response?.data?.detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ");
    }
    if (typeof detail === "string") {
      return detail;
    }
    if (typeof maybeAxios.response?.data?.message === "string") {
      return maybeAxios.response.data.message;
    }
    if (typeof maybeAxios.message === "string") {
      return maybeAxios.message;
    }
  }
  return "Something went wrong. Please try again.";
};

function App() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagSummary, setTagSummary] = useState<TagSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(defaultSortConfig);
  const [showClosed, setShowClosed] = useState(false);

  const [editing, setEditing] = useState<Position | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [timeseriesOpen, setTimeseriesOpen] = useState(false);
  const [timeseriesData, setTimeseriesData] = useState<TagTimeseriesResponse | null>(null);
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null);
  const [timeseriesPeriod, setTimeseriesPeriod] = useState("6mo");
  const [timeseriesInterval, setTimeseriesInterval] = useState("1d");
  const [timeseriesSelection, setTimeseriesSelection] = useState<string[]>([]);
  const [timeseriesMetric, setTimeseriesMetric] = useState<"market_value" | "unrealized_pl">(
    "market_value",
  );
  const [timeseriesNormalize, setTimeseriesNormalize] = useState(false);
  const timeseriesCache = useRef<Map<string, TagTimeseriesResponse>>(new Map());

  useEffect(() => {
    if (!mutationSuccess) {
      return;
    }
    const timer = window.setTimeout(() => setMutationSuccess(null), 4000);
    return () => window.clearTimeout(timer);
  }, [mutationSuccess]);

  useEffect(() => {
    if (!mutationError) {
      return;
    }
    const timer = window.setTimeout(() => setMutationError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [mutationError]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [positionsRes, tagsRes, tagSummaryRes] = await Promise.all([
        fetchPositions(),
        fetchTags(),
        fetchTagSummary(),
      ]);
      setPositions(positionsRes);
      setTags(tagsRes);
      setTagSummary(tagSummaryRes);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const reloadData = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const handleCreate = useCallback(
    async (payload: CreatePositionPayload) => {
      setMutating(true);
      setMutationError(null);
      setMutationSuccess(null);
      try {
        await createPosition(payload);
        await reloadData();
        setMutationSuccess(`Added ${payload.symbol}`);
      } catch (err) {
        setMutationError(extractErrorMessage(err));
      } finally {
        setMutating(false);
      }
    },
    [reloadData],
  );

  const handleEdit = useCallback((position: Position) => {
    setEditing(position);
    setMutationError(null);
    setMutationSuccess(null);
  }, []);

  const handleUpdate = useCallback(
    async (id: string, payload: UpdatePositionPayload) => {
      setMutating(true);
      setMutationError(null);
      setMutationSuccess(null);
      try {
        await updatePosition(id, payload);
        await reloadData();
        setMutationSuccess(`Updated ${payload.symbol ?? id}`);
      } catch (err) {
        const message = extractErrorMessage(err);
        setMutationError(message);
        throw new Error(message);
      } finally {
        setMutating(false);
      }
    },
    [reloadData],
  );

  const handleDelete = useCallback(
    async (position: Position) => {
      if (!position.id) {
        return;
      }
      const confirmed = window.confirm(`Delete ${position.symbol}?`);
      if (!confirmed) {
        return;
      }
      setDeletingId(position.id);
      setMutationError(null);
      setMutationSuccess(null);
      try {
        await deletePosition(position.id);
        await reloadData();
        setMutationSuccess(`Deleted ${position.symbol}`);
      } catch (err) {
        setMutationError(extractErrorMessage(err));
      } finally {
        setDeletingId(null);
      }
    },
    [reloadData],
  );

  const handleSortChange = useCallback((column: SortableColumn) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        return {
          column,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { column, direction: "asc" };
    });
  }, []);

  const handleResetSort = useCallback(() => {
    setSortConfig(defaultSortConfig);
  }, []);

  const openTimeseries = useCallback((selection: string[]) => {
    setTimeseriesSelection(selection);
    setTimeseriesOpen(true);
  }, []);

  const closeTimeseries = useCallback(() => {
    setTimeseriesOpen(false);
  }, []);

  const loadTimeseries = useCallback(
    async (period: string, interval: string) => {
      const key = `${period}_${interval}`;
      if (timeseriesCache.current.has(key)) {
        setTimeseriesData(timeseriesCache.current.get(key) ?? null);
        return;
      }
      setTimeseriesLoading(true);
      setTimeseriesError(null);
      try {
        const response = await fetchTagTimeseries(period, interval);
        timeseriesCache.current.set(key, response);
        setTimeseriesData(response);
      } catch (err) {
        setTimeseriesError(extractErrorMessage(err));
      } finally {
        setTimeseriesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!timeseriesOpen) {
      return;
    }
    loadTimeseries(timeseriesPeriod, timeseriesInterval);
  }, [timeseriesOpen, timeseriesPeriod, timeseriesInterval, loadTimeseries]);

  const tagSuggestions = useMemo(() => tags.map((tag) => tag.name).filter(Boolean), [tags]);

  const filteredPositions = useMemo(() => {
    let working = positions;
    if (filterTag) {
      working = working.filter((position) => (position.tags || []).includes(filterTag));
    }
    if (!showClosed) {
      working = working.filter((position) => !position.is_closed);
    }
    return working;
  }, [positions, filterTag, showClosed]);

  const portfolioView = useMemo(() => buildPortfolioView(filteredPositions), [filteredPositions]);

  return (
    <div className="app-shell">
      <header style={{ marginBottom: 24 }}>
        <h1>📊 AI Portfolio Dashboard</h1>
        <p className="muted">
          React-based dashboard for tracking positions, tags, and performance over time.
        </p>
      </header>

      {error && (
        <div className="card" style={{ borderLeft: "4px solid #dc2626" }}>
          <strong>Error:</strong> {error}
          <div style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={loadAll}>
              Retry
            </button>
          </div>
        </div>
      )}

      {mutationError && (
        <div className="card" style={{ borderLeft: "4px solid #dc2626" }}>
          <strong>Action failed:</strong> {mutationError}
        </div>
      )}

      {mutationSuccess && (
        <div className="card" style={{ borderLeft: "4px solid #22c55e" }}>
          {mutationSuccess}
        </div>
      )}

      <AddPositionForm
        onCreate={handleCreate}
        loading={mutating}
        tagSuggestions={tagSuggestions}
      />

      <TagSummary
        rows={tagSummary}
        activeFilter={filterTag}
        onFilter={setFilterTag}
        onOpenTimeseries={openTimeseries}
      />

      <TotalsPanel totals={portfolioView.totals} />

      {loading ? (
        <div className="card">
          <div className="loading">Loading positions…</div>
        </div>
      ) : (
        <PositionsTable
          rows={portfolioView.rows}
          pnlRange={portfolioView.ranges.pnlRange}
          intradayRange={portfolioView.ranges.intradayRange}
          tenDayRange={portfolioView.ranges.tenDayRange}
          sortConfig={sortConfig}
          onChangeSort={handleSortChange}
          onResetSort={handleResetSort}
          showClosed={showClosed}
          onToggleShowClosed={setShowClosed}
          onEdit={handleEdit}
          onDelete={handleDelete}
          mutating={mutating}
          deletingId={deletingId}
        />
      )}

      <PositionsPie rows={portfolioView.rows} />

      {editing && (
        <EditPositionModal
          position={editing}
          onClose={() => setEditing(null)}
          onSubmit={handleUpdate}
          loading={mutating}
          tagSuggestions={tagSuggestions}
        />
      )}

      <TimeseriesPanel
        open={timeseriesOpen}
        data={timeseriesData}
        loading={timeseriesLoading}
        error={timeseriesError}
        period={timeseriesPeriod}
        interval={timeseriesInterval}
        onPeriodChange={(value) => setTimeseriesPeriod(value)}
        onIntervalChange={(value) => setTimeseriesInterval(value)}
        selection={timeseriesSelection}
        onSelectionChange={setTimeseriesSelection}
        metric={timeseriesMetric}
        onMetricChange={setTimeseriesMetric}
        normalize={timeseriesNormalize}
        onNormalizeChange={setTimeseriesNormalize}
        onClose={closeTimeseries}
      />
    </div>
  );
}

export default App;
