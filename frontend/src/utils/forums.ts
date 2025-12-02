const FORUM_OVERRIDES: Record<string, string> = {
  NVDA: "https://www.boursorama.com/bourse/forum/NVDA/",
  SAF: "https://www.boursorama.com/bourse/forum/1rPSAF/",
  PARRO: "https://www.boursorama.com/bourse/forum/1rPPARRO/",
  HO: "https://www.boursorama.com/bourse/forum/1rPHO/",
  AM: "https://www.boursorama.com/bourse/forum/1rPAM/",
  EXA: "https://www.boursorama.com/bourse/forum/1rPEXA/",
  LBIRD: "https://www.boursorama.com/bourse/forum/1rPLBIRD/",
  RHM: "https://www.boursorama.com/bourse/forum/1zRHM/",
};

const DEFAULT_BASE = "https://www.boursorama.com/bourse/forum";

const cleanSymbol = (symbol: string) => {
  const upper = symbol.toUpperCase();
  const base = upper.split(/[.\-\s]/)[0];
  return base.replace(/[^A-Z0-9]/g, "");
};

export function buildBoursoramaForumUrl(symbol: string | null | undefined): string | null {
  if (!symbol) {
    return null;
  }
  const cleaned = cleanSymbol(symbol);
  if (!cleaned) {
    return null;
  }
  if (FORUM_OVERRIDES[cleaned]) {
    return FORUM_OVERRIDES[cleaned];
  }
  return `${DEFAULT_BASE}/1rP${cleaned}/`;
}
