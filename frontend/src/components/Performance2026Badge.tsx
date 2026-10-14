import { useEffect, useState } from "react";
import { fetchPersonalPerformance2026 } from "../api/client";
import type { PersonalPerformance } from "../api/performance";
import { formatCurrency, formatSignedPercent } from "../utils/format";

export function Performance2026Result({ report }: { report: PersonalPerformance | null }) {
  const result = report?.indicative ?? (report?.status !== "incomplete" ? report : null);
  const rate = result?.effective_return_pct ?? null;
  const gain = result?.net_gain_eur ?? null;
  const background = rate === null ? "#64748b" : rate >= 0 ? "#34a853" : "#d93025";
  return <span
    className="badge"
    style={{ background, color: "#fff", fontSize: 14, padding: "6px 12px" }}
  >
    Performance 2026: {gain === null ? "—" : `${gain > 0 ? "+" : ""}${formatCurrency(gain, "EUR")}`} ({rate === null ? "—" : formatSignedPercent(rate)})
  </span>;
}

export default function Performance2026Badge({ revision }: { revision: string }) {
  const [report, setReport] = useState<PersonalPerformance | null>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    setReport(null);
    const refresh = () => {
      const current = ++request;
      fetchPersonalPerformance2026().then((data) => { if (active && current === request) setReport(data); })
        .catch(() => { if (active && current === request) setReport(null); });
    };
    refresh();
    // Cash and external flows can change without modifying any position.
    // Refresh the same badge, including when the user returns to the tab.
    const timer = typeof window !== "undefined" ? window.setInterval(refresh, 60_000) : null;
    if (typeof window !== "undefined") window.addEventListener("focus", refresh);
    return () => {
      active = false;
      if (typeof window !== "undefined") {
        if (timer !== null) window.clearInterval(timer);
        window.removeEventListener("focus", refresh);
      }
    };
  }, [revision]);
  return <Performance2026Result report={report} />;
}
