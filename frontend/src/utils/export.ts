export type CsvRow = Record<string, unknown>;

const normalizeCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCellValue(item)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const escapeCsvCell = (value: unknown): string => {
  const raw = normalizeCellValue(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!raw) {
    return "";
  }
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

export function rowsToCsv(rows: CsvRow[], columns?: string[]): string {
  const headers =
    columns ??
    Array.from(
      rows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()),
    );

  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((key) => escapeCsvCell(row[key])).join(","));
  }
  return lines.join("\n");
}

export function timestampForFilename(date = new Date()): string {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: CsvRow[], columns?: string[]): void {
  const csv = rowsToCsv(rows, columns);
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

export function downloadJson(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  downloadBlob(filename, new Blob([text], { type: "application/json;charset=utf-8" }));
}

