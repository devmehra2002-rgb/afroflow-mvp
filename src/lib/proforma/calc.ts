// Proforma invoice maths and validation. Plain code, no AI: prices are typed by
// a person, and this file only adds them up.

export const CURRENCIES = ["USD", "EUR", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

// A line is either an item, or a section heading (for example "SECTION A")
// that only labels the items under it.
export interface ProformaLine {
  heading?: boolean;
  code: string;
  description: string;
  hsn: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface ProformaData {
  buyerName: string;
  buyerAddress: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerRef: string; // "Your Ref"
  currency: Currency;
  exchangeRateToInr: number | null; // INR per 1 unit of currency; only used when currency != INR
  incoterm: string;
  portOfLoading: string;
  portOfDischarge: string;
  countryOfOrigin: string;
  paymentTerms: string;
  shipmentMode: string;
  deliveryTime: string;
  packing: string;
  issueDate: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  notes: string;
  termsText: string;
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

export const VALIDITY_DAYS = 30;
export const MAX_LINES = 1000;
export const DEFAULT_TERMS = "Proforma invoice for the buyer's confirmation. Prices are valid until the date shown above.";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const isItem = (l: ProformaLine) => !l.heading;

export function lineAmount(l: Pick<ProformaLine, "quantity" | "unitPrice" | "heading">): number {
  if (l.heading) return 0;
  return round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0));
}

export function totals(d: Pick<ProformaData, "lines" | "currency" | "exchangeRateToInr">) {
  const total = round2(d.lines.reduce((s, l) => s + lineAmount(l), 0));
  const rate = d.exchangeRateToInr && d.exchangeRateToInr > 0 ? d.exchangeRateToInr : null;
  const inr = d.currency === "INR" ? total : rate ? round2(total * rate) : null;
  return { total, inr };
}

// ---- amount in words ("ONE THOUSAND TWO HUNDRED THIRTY FOUR & CENTS FIFTY SIX ONLY") ----
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`);
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " + below100(n % 100) : ""}` : below100(n));

export function wholeToWords(n: number, indian = false): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  let rest = Math.floor(n);
  const scales: [number, string][] = indian
    ? [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]]
    : [[1_000_000_000, "Billion"], [1_000_000, "Million"], [1000, "Thousand"]];
  for (const [size, name] of scales) {
    if (rest >= size) { parts.push(`${wholeToWords(Math.floor(rest / size), indian)} ${name}`); rest %= size; }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

export function amountInWords(amount: number, currency: Currency): string {
  const a = Math.max(0, round2(amount));
  const whole = Math.floor(a);
  const sub = Math.round((a - whole) * 100);
  const words = wholeToWords(whole, currency === "INR");
  const subName = currency === "INR" ? "Paise" : "Cents";
  return `${currency} ${words}${sub ? ` & ${subName} ${wholeToWords(sub)}` : ""} Only`;
}

// ---- numbering: "PI/2026-27/101" (Indian financial year, April to March) ----
export function financialYear(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4)), m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function proformaNumber(prefix: string, isoDate: string, seq: number, version = 1): string {
  const base = `${prefix}/${financialYear(isoDate)}/${seq}`;
  return version > 1 ? `${base}-R${version - 1}` : base;
}

export const baseNumber = (n: string) => n.replace(/-R\d+$/, "");
export const revisedNumber = (n: string, version: number) => (version > 1 ? `${baseNumber(n)}-R${version - 1}` : baseNumber(n));
export const fileSafe = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "-");

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
    buyerPhone: "",
    buyerEmail: "",
    buyerRef: "",
    currency: "USD",
    exchangeRateToInr: null,
    incoterm: "",
    portOfLoading: "",
    portOfDischarge: "",
    countryOfOrigin: "India",
    paymentTerms: o.terms ?? "",
    shipmentMode: "By sea",
    deliveryTime: "",
    packing: "",
    issueDate: today,
    validUntil: addDays(today, VALIDITY_DAYS),
    notes: "",
    termsText: DEFAULT_TERMS,
    lines: [{ code: "", description: o.product, hsn: "", quantity, unit, unitPrice }],
  };
}

// ---- pasting items from Excel: Code | Description | Qty | Unit price (tab separated) ----
export function parsePastedItems(text: string): { lines: ProformaLine[]; skipped: number } {
  const lines: ProformaLine[] = [];
  let skipped = 0;
  // "1,200.50" is fine; "1,5" (a European 1.50) is refused rather than guessed, so a price is never off by 10x
  const num = (s: string) => (/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(s.trim()) ? Number(s.replace(/,/g, "")) : NaN);
  for (const raw of (text ?? "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.split("\t").map((c) => c.trim());
    const filled = cells.filter(Boolean);
    if (filled.length === 1) { lines.push({ heading: true, code: "", description: filled[0].slice(0, 300), hsn: "", quantity: 0, unit: "", unitPrice: 0 }); continue; }
    let code = "", description = "", qty = "", price = "";
    if (cells.length >= 4) [code, description, qty, price] = cells;
    else if (cells.length === 3) [description, qty, price] = cells;
    else { skipped++; continue; }
    const q = num(qty), p = num(price);
    if (!description || !(q > 0) || !(p >= 0)) { skipped++; continue; }
    lines.push({ code: code.slice(0, 60), description: description.slice(0, 300), hsn: "", quantity: q, unit: "pcs", unitPrice: p });
  }
  return { lines: lines.slice(0, MAX_LINES), skipped: skipped + Math.max(0, lines.length - MAX_LINES) };
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

  const rawLines = Array.isArray(r.lines) ? r.lines.slice(0, MAX_LINES) : [];
  const lines: ProformaLine[] = rawLines.map((x) => {
    const l = (x ?? {}) as Record<string, unknown>;
    if (l.heading) return { heading: true, code: "", description: str(l.description, 300), hsn: "", quantity: 0, unit: "", unitPrice: 0 };
    return { code: str(l.code, 60), description: str(l.description, 300), hsn: str(l.hsn, 20), quantity: Number(l.quantity), unit: str(l.unit, 20) || "units", unitPrice: Number(l.unitPrice) };
  });
  if (!lines.some(isItem)) errors.push("Add at least one item.");
  lines.forEach((l, i) => {
    if (l.heading) { if (!l.description) errors.push(`Line ${i + 1}: the section heading is empty.`); return; }
    if (!l.description) errors.push(`Line ${i + 1}: add a description.`);
    if (!(l.quantity > 0)) errors.push(`Line ${i + 1}: quantity must be more than 0.`);
    if (!(l.unitPrice >= 0) || Number.isNaN(l.unitPrice)) errors.push(`Line ${i + 1}: unit price must be 0 or more.`);
  });
  const rate = r.exchangeRateToInr === null || r.exchangeRateToInr === "" || r.exchangeRateToInr === undefined ? null : Number(r.exchangeRateToInr);
  if (rate !== null && !(rate > 0)) errors.push("Exchange rate must be more than 0.");

  if (errors.length) return { data: null, errors: errors.slice(0, 8) };
  return {
    errors,
    data: {
      buyerName: str(r.buyerName, 200), buyerAddress: str(r.buyerAddress, 600), buyerPhone: str(r.buyerPhone, 60), buyerEmail: str(r.buyerEmail, 120),
      buyerRef: str(r.buyerRef, 120), currency: currency!, exchangeRateToInr: currency === "INR" ? null : rate,
      incoterm: str(r.incoterm, 40), portOfLoading: str(r.portOfLoading, 100), portOfDischarge: str(r.portOfDischarge, 100),
      countryOfOrigin: str(r.countryOfOrigin, 60), paymentTerms: str(r.paymentTerms, 300), shipmentMode: str(r.shipmentMode, 60),
      deliveryTime: str(r.deliveryTime, 100), packing: str(r.packing, 200), issueDate: r.issueDate as string, validUntil: r.validUntil as string,
      notes: str(r.notes, 1000), termsText: str(r.termsText, 1500), lines,
    },
  };
}

// Approval needs every price filled in (a 0.00 draft is fine to save, not to approve).
export function approvalProblems(d: ProformaData): string[] {
  const p: string[] = [];
  if (!d.buyerName) p.push("Add the buyer's name.");
  const bad = d.lines.map((l, i) => ({ l, i })).filter(({ l }) => isItem(l) && !(l.unitPrice > 0));
  bad.slice(0, 3).forEach(({ i }) => p.push(`Line ${i + 1}: enter the agreed unit price.`));
  if (bad.length > 3) p.push(`${bad.length - 3} more lines have no unit price.`);
  if (!d.incoterm) p.push("Add the incoterm (for example FOB or CIF).");
  if (!d.paymentTerms) p.push("Add the payment terms.");
  return p;
}
