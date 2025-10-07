import type { CSSProperties } from "react";

const GS_RED = "#d93025";
const GS_YEL = "#fbbc04";
const GS_GRN = "#34a853";
const NEUTRAL = "#e9ecef";

const BASE_CELL: CSSProperties = {
  borderRadius: "6px",
  padding: "2px 6px",
  display: "inline-block",
  minWidth: "64px",
  textAlign: "right",
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.substring(0, 2), 16);
  const g = Number.parseInt(clean.substring(2, 4), 16);
  const b = Number.parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
}

function blend(c1: string, c2: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  const r = Math.round(r1 + (r2 - r1) * clamped);
  const g = Math.round(g1 + (g2 - g1) * clamped);
  const b = Math.round(b1 + (b2 - b1) * clamped);
  return rgbToHex([r, g, b]);
}

function neutralStyle(): CSSProperties {
  return {
    ...BASE_CELL,
    backgroundColor: NEUTRAL,
    color: "black",
  };
}

export function colorFromScale(
  value: number | null | undefined,
  vmin: number,
  vmed: number,
  vmax: number,
): CSSProperties {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return neutralStyle();
  }

  if (vmin === vmax) {
    return neutralStyle();
  }

  let color = GS_YEL;
  if (value <= vmed) {
    const t = vmed === vmin ? 0 : (value - vmin) / (vmed - vmin);
    color = blend(GS_RED, GS_YEL, t);
  } else {
    const t = vmax === vmed ? 1 : (value - vmed) / (vmax - vmed);
    color = blend(GS_YEL, GS_GRN, t);
  }

  return {
    ...BASE_CELL,
    color: "white",
    backgroundColor: color,
  };
}

export function colorFromScaleIntraday(
  value: number | null | undefined,
  vmin: number,
  vmax: number,
): CSSProperties {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return neutralStyle();
  }
  const negMin = Math.min(0, vmin);
  const posMax = Math.max(0, vmax);
  let color = GS_YEL;
  if (value < 0 && negMin < 0) {
    const t = (value - negMin) / (0 - negMin);
    color = blend(GS_RED, GS_YEL, t);
  } else if (value > 0 && posMax > 0) {
    const t = value / posMax;
    color = blend(GS_YEL, GS_GRN, t);
  }
  return {
    ...BASE_CELL,
    color: "white",
    backgroundColor: color,
  };
}
