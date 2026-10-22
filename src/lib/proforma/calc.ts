// Proforma invoice maths and validation. Plain code, no AI: prices are typed by
// a person, and this file only adds them up.

export const CURRENCIES = ["USD", "EUR", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface ProformaLine {
  description: string;
  hsn: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface ProformaData {
  buyerName: string;
  buyerAddress: string;
  currency: Currency;
  exchangeRateToInr: number | null; // INR per 1 unit of currency; only used when currency != INR
  incoterm: string;
  portOfLoading: string;
  portOfDischarge: string;
  paymentTerms: string;
  issueDate: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  notes: string;
  lines: ProformaLine[];
}

export interface OrderLike {
  id: string;
  customerName: string;
  country?: string | null;
  product: string;
  qty?: string | null;
  value: number;
  terms?: string | null;
}

export const VALIDITY_DAYS = 15;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineAmount(l: Pick<ProformaLine, "quantity" | "unitPrice">): number {
  return round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0));
}

export function totals(d: Pick<ProformaData, "lines" | "currency" | "exchangeRateToInr">) {
  const total = round2(d.lines.reduce((s, l) => s + lineAmount(l), 0));
  const rate = d.exchangeRateToInr && d.exchangeRateToInr > 0 ? d.exchangeRateToInr : null;
  const inr = d.currency === "INR" ? total : rate ? round2(total * rate) : null;
  return { total, inr };
}

// "AA-2026-021" -> "PI-2026-021" (one proforma per order; revisions add a suffix)
export function proformaNumber(orderId: string, version = 1): string {
  const base = orderId.replace(/^AA-/i, "PI-");
  return version > 1 ? `${base}-R${version - 1}` : base;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// First number in "5,000 pcs" / "2 x 40 ft" style text, and the word after it.
export function parseQty(qty: string | null | undefined): { quantity: number; unit: string } {
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(qty ?? "");
  if (!m) return { quantity: 1, unit: "units" };
  const quantity = Number(m[1].replace(/,/g, ""));
  return { quantity: quantity > 0 ? quantity : 1, unit: m[2] && m[2].toLowerCase() !== "x" ? m[2] : "units" };
}

// First draft from the order. The unit price is worked out from the order value
// as a starting point only: a person checks it before approving.
export function defaultProforma(o: OrderLike, today: string): ProformaData {
  const { quantity, unit } = parseQty(o.qty);
  const unitPrice = o.value > 0 ? round2(o.value / quantity) : 0;
  return {
    buyerName: o.customerName,
    buyerAddress: o.country ?? "",
    currency: "USD",
    exchangeRateToInr: null,
    incoterm: "",
    portOfLoading: "",
    portOfDischarge: "",
    paymentTerms: o.terms ?? "",
    issueDate: today,
    validUntil: addDays(today, VALIDITY_DAYS),
    notes: "",
    lines: [{ description: o.product, hsn: "", quantity, unit, unitPrice }],
  };
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Cleans whatever the browser sent. Returns the clean data and a list of problems.
export function sanitizeProforma(raw: unknown): { data: ProformaData | null; errors: string[] } {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const currency = (CURRENCIES as readonly string[]).includes(r.currency as string) ? (r.currency as Currency) : null;
  if (!currency) errors.push("Choose a currency.");
  if (!isDay(r.issueDate)) errors.push("Issue date is not a valid date.");
  if (!isDay(r.validUntil)) errors.push("Valid-until date is not a valid date.");
  if (isDay(r.issueDate) && isDay(r.validUntil) && r.validUntil < r.issueDate) errors.push("Valid-until is before the issue date.");

  const rawLines = Array.isArray(r.lines) ? r.lines.slice(0, 30) : [];
  const lines: ProformaLine[] = rawLines.map((x) => {
    const l = (x ?? {}) as Record<string, unknown>;
    return { description: str(l.description, 300), hsn: str(l.hsn, 20), quantity: Number(l.quantity), unit: str(l.unit, 20) || "units", unitPrice: Number(l.unitPrice) };
  });
  if (!lines.length) errors.push("Add at least one line.");
  lines.forEach((l, i) => {
    if (!l.description) errors.push(`Line ${i + 1}: add a description.`);
    if (!(l.quantity > 0)) errors.push(`Line ${i + 1}: quantity must be more than 0.`);
    if (!(l.unitPrice >= 0) || Number.isNaN(l.unitPrice)) errors.push(`Line ${i + 1}: unit price must be 0 or more.`);
  });
  const rate = r.exchangeRateToInr === null || r.exchangeRateToInr === "" || r.exchangeRateToInr === undefined ? null : Number(r.exchangeRateToInr);
  if (rate !== null && !(rate > 0)) errors.push("Exchange rate must be more than 0.");

  if (errors.length) return { data: null, errors };
  return {
    errors,
    data: {
      buyerName: str(r.buyerName, 200), buyerAddress: str(r.buyerAddress, 600), currency: currency!,
      exchangeRateToInr: currency === "INR" ? null : rate,
      incoterm: str(r.incoterm, 40), portOfLoading: str(r.portOfLoading, 100), portOfDischarge: str(r.portOfDischarge, 100),
      paymentTerms: str(r.paymentTerms, 300), issueDate: r.issueDate as string, validUntil: r.validUntil as string,
      notes: str(r.notes, 1000), lines,
    },
  };
}

// Approval needs every price filled in (a 0.00 draft is fine to save, not to approve).
export function approvalProblems(d: ProformaData): string[] {
  const p: string[] = [];
  if (!d.buyerName) p.push("Add the buyer's name.");
  d.lines.forEach((l, i) => { if (!(l.unitPrice > 0)) p.push(`Line ${i + 1}: enter the agreed unit price.`); });
  if (!d.incoterm) p.push("Add the incoterm (for example CIF).");
  if (!d.paymentTerms) p.push("Add the payment terms.");
  return p;
}
