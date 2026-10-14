import { useEffect, useState } from "react";
import { fetchAnnualPerformance } from "../api/client";
import AnnualPerformanceManager from "./AnnualPerformanceManager";
import type { PersonalPerformance } from "../api/performance";
import { formatCurrency, formatSignedPercent } from "../utils/format";

export function Performance2026Result({ report, year = 2026 }: { report: PersonalPerformance | null; year?: number }) {
  const result = report?.indicative ?? (report?.status !== "incomplete" ? report : null);
  const rate = result?.effective_return_pct ?? null;
  const gain = result?.net_gain_eur ?? null;
  const background = rate === null ? "#64748b" : rate >= 0 ? "#34a853" : "#d93025";
  return <span
    className="badge"
    style={{ background, color: "#fff", fontSize: 14, padding: "6px 12px" }}
  >
    Performance {year}: {gain === null ? "—" : `${gain > 0 ? "+" : ""}${formatCurrency(gain, "EUR")}`} ({rate === null ? "—" : formatSignedPercent(rate)})
  </span>;
}

export default function Performance2026Badge({ revision }: { revision: string }) {
  const currentYear = () => Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date()));
  const [calendarYear, setCalendarYear] = useState(currentYear);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const year = selectedYear ?? calendarYear;
  const [manage, setManage] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);
  const [report, setReport] = useState<PersonalPerformance | null>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    setReport(null);
    const refresh = () => {
      setCalendarYear(currentYear());
      const current = ++request;
      fetchAnnualPerformance(year).then((data) => { if (active && current === request) setReport(data); })
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
  }, [revision, year, inputRevision]);
  return <><Performance2026Result report={report} year={year} />
    <button className="annual-manage-link" type="button" onClick={() => setManage(true)}>Gérer la performance annuelle</button>
    {manage && <AnnualPerformanceManager year={year} onYear={setSelectedYear} onClose={() => setManage(false)} onChange={() => setInputRevision((v) => v + 1)} />}
  </>;
}
