// Normalization applied before any comparison, so differences in formatting
// never register as a discrepancy — only differences in substance do.

const COMPANY_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt. ltd.",
  "pvt ltd.",
  "p.l.c.",
  "plc",
  "limited",
  "ltd",
  "ltd.",
  "llc",
  "l.l.c.",
  "inc",
  "inc.",
  "incorporated",
  "corp",
  "corp.",
  "corporation",
  "co",
  "co.",
  "company",
];

export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.toLowerCase().trim();
  out = out.replace(/[.,'"()]/g, "");
  out = out.replace(/\s+/g, " ");
  return out;
}

export function normalizeCompanyName(s: string | null | undefined): string {
  let out = normalizeText(s);
  for (const suffix of COMPANY_SUFFIXES) {
    const plain = suffix.replace(/\./g, "");
    out = out.replace(new RegExp(`\\b${plain}\\b`, "g"), "").trim();
  }
  return out.replace(/\s+/g, " ").trim();
}

// Accepts "1,234.56", "1234.56", "1 234,56" (loosely) and plain numbers.
export function normalizeNumber(n: number | string | null | undefined): number | null {
  if (n == null) return null;
  if (typeof n === "number") return Number.isFinite(n) ? n : null;
  const cleaned = n.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  // If both separators are present, assume the last one is the decimal point.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Single comma: treat as thousands separator unless it looks decimal (2 digits after).
    const digitsAfter = cleaned.length - lastComma - 1;
    normalized = digitsAfter === 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "us$": "USD",
  "usd": "USD",
  "€": "EUR",
  "eur": "EUR",
  "£": "GBP",
  "gbp": "GBP",
  "₹": "INR",
  "rs": "INR",
  "rs.": "INR",
  "inr": "INR",
  "aed": "AED",
};

export function normalizeCurrency(c: string | null | undefined): string | null {
  if (!c) return null;
  const key = c.toLowerCase().trim();
  return CURRENCY_SYMBOLS[key] ?? c.toUpperCase().trim();
}

// Accepts common date formats and returns ISO yyyy-mm-dd, or null if it can't
// be parsed confidently.
export function normalizeDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const trimmed = d.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dmy) {
    const [, d1, m1, y1] = dmy;
    return `${y1}-${m1.padStart(2, "0")}-${d1.padStart(2, "0")}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

export function normalizeContainerType(t: string | null | undefined): "20ft" | "40ft" | null {
  if (!t) return null;
  const s = t.toLowerCase().replace(/\s+/g, "");
  if (s.includes("20")) return "20ft";
  if (s.includes("40")) return "40ft";
  return null;
}

const CLOSE_ENOUGH = 0.01; // 1% tolerance for floating-point / rounding noise

export function numbersMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  if (a === 0 && b === 0) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / base <= CLOSE_ENOUGH;
}
