import type { ExtractedDocument, ExtractedField, LineItem } from "./schema";
import {
  normalizeText,
  normalizeCompanyName,
  normalizeNumber,
  normalizeCurrency,
  normalizeDate,
  normalizeContainerType,
  numbersMatch,
} from "./normalize";

export type Severity = "CRITICAL" | "WARNING" | "INFO";

export interface Discrepancy {
  field: string;
  severity: Severity;
  foundValue: string | null;
  foundSource: string;
  expectedValue: string | null;
  expectedSource: string;
}

// The subset of an order's own fields a document can meaningfully be checked
// against. Orders live in the static page's local storage, not in this
// database — HSN code, Incoterms, and ports aren't tracked on the order
// record today, so those only get cross-checked document-to-document.
export interface OrderRecord {
  id: string;
  customer: string;
  product: string;
  containerType: "20ft" | "40ft" | null;
  containerCount: number | null;
  value: number;
  currency: string;
  shipDate: string | null; // ISO
}

const LOW_CONFIDENCE = 0.6;

function fv<T>(f: ExtractedField<T> | undefined): T | null {
  return f?.value ?? null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function pushIfMismatch(
  out: Discrepancy[],
  field: string,
  severity: Severity,
  foundRaw: unknown,
  foundSource: string,
  expectedRaw: unknown,
  expectedSource: string,
  equal: boolean
) {
  if (equal) return;
  out.push({
    field,
    severity,
    foundValue: str(foundRaw),
    foundSource,
    expectedValue: str(expectedRaw),
    expectedSource,
  });
}

// ---- 1. Document vs. order record ----
export function compareDocumentToOrder(
  extracted: ExtractedDocument,
  docLabel: string,
  order: OrderRecord
): Discrepancy[] {
  const out: Discrepancy[] = [];

  const buyer = fv(extracted.buyer);
  if (buyer != null) {
    pushIfMismatch(
      out,
      "Buyer / Consignee",
      "CRITICAL",
      buyer,
      docLabel,
      order.customer,
      "Order record",
      normalizeCompanyName(buyer) === normalizeCompanyName(order.customer)
    );
  }

  const product = fv(extracted.productDescription);
  if (product != null) {
    pushIfMismatch(
      out,
      "Product Description",
      "WARNING",
      product,
      docLabel,
      order.product,
      "Order record",
      normalizeText(product) === normalizeText(order.product)
    );
  }

  if (order.containerType != null) {
    const containerType = normalizeContainerType(fv(extracted.containerType));
    if (containerType != null) {
      pushIfMismatch(
        out,
        "Container Type",
        "CRITICAL",
        fv(extracted.containerType),
        docLabel,
        order.containerType,
        "Order record",
        containerType === order.containerType
      );
    }
  }

  if (order.containerCount != null) {
    const containerCount = normalizeNumber(fv(extracted.containerCount));
    if (containerCount != null) {
      pushIfMismatch(
        out,
        "Number of Containers",
        "CRITICAL",
        containerCount,
        docLabel,
        order.containerCount,
        "Order record",
        numbersMatch(containerCount, order.containerCount)
      );
    }
  }

  const totalValue = normalizeNumber(fv(extracted.totalValue));
  if (totalValue != null) {
    pushIfMismatch(
      out,
      "Total Value",
      "CRITICAL",
      totalValue,
      docLabel,
      order.value,
      "Order record",
      numbersMatch(totalValue, order.value)
    );
  }

  const currency = normalizeCurrency(fv(extracted.currency));
  if (currency != null) {
    pushIfMismatch(
      out,
      "Currency",
      "CRITICAL",
      currency,
      docLabel,
      order.currency,
      "Order record",
      currency === normalizeCurrency(order.currency)
    );
  }

  return out;
}

// ---- 2. Document vs. document ----
const CROSS_DOC_FIELDS: Array<{
  key: keyof ExtractedDocument;
  label: string;
  severity: Severity;
  normalize: (v: unknown) => unknown;
}> = [
  { key: "buyer", label: "Buyer / Consignee", severity: "CRITICAL", normalize: (v) => normalizeCompanyName(v as string) },
  { key: "productDescription", label: "Product Description", severity: "WARNING", normalize: (v) => normalizeText(v as string) },
  { key: "hsnCode", label: "HSN Code", severity: "CRITICAL", normalize: (v) => normalizeText(v as string) },
  { key: "containerType", label: "Container Type", severity: "CRITICAL", normalize: (v) => normalizeContainerType(v as string) },
  { key: "containerCount", label: "Number of Containers", severity: "CRITICAL", normalize: (v) => normalizeNumber(v as number) },
  { key: "totalValue", label: "Total Value", severity: "CRITICAL", normalize: (v) => normalizeNumber(v as number) },
  { key: "currency", label: "Currency", severity: "CRITICAL", normalize: (v) => normalizeCurrency(v as string) },
  { key: "incoterms", label: "Incoterms", severity: "WARNING", normalize: (v) => normalizeText(v as string) },
  { key: "paymentTerms", label: "Payment Terms", severity: "WARNING", normalize: (v) => normalizeText(v as string) },
  { key: "portOfLoading", label: "Port of Loading", severity: "WARNING", normalize: (v) => normalizeText(v as string) },
  { key: "portOfDischarge", label: "Port of Discharge", severity: "WARNING", normalize: (v) => normalizeText(v as string) },
  { key: "countryOfDestination", label: "Country of Destination", severity: "WARNING", normalize: (v) => normalizeText(v as string) },
];

export interface LabeledDocument {
  label: string;
  extracted: ExtractedDocument;
}

// Compares every pair of supplied documents on the fields both of them
// extracted. Only emits one discrepancy per mismatching pair/field, not a
// combinatorial explosion across every document.
export function compareDocuments(docs: LabeledDocument[]): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      for (const f of CROSS_DOC_FIELDS) {
        const aField = a.extracted[f.key] as ExtractedField<unknown>;
        const bField = b.extracted[f.key] as ExtractedField<unknown>;
        const aVal = fv(aField);
        const bVal = fv(bField);
        if (aVal == null || bVal == null) continue;
        const aNorm = f.normalize(aVal);
        const bNorm = f.normalize(bVal);
        const equal =
          typeof aNorm === "number" && typeof bNorm === "number"
            ? numbersMatch(aNorm, bNorm)
            : aNorm === bNorm;
        pushIfMismatch(out, f.label, f.severity, aVal, a.label, bVal, b.label, equal);
      }
    }
  }
  return out;
}

// ---- 3. Internal consistency (math + date order) ----
export function checkLineItemMath(items: LineItem[] | null, docLabel: string, totalValue: number | null): Discrepancy[] {
  const out: Discrepancy[] = [];
  if (!items || items.length === 0) return out;

  items.forEach((item, idx) => {
    const expected = item.quantity * item.unitPrice;
    if (!numbersMatch(expected, item.lineTotal)) {
      out.push({
        field: `Line ${idx + 1} total (${item.description})`,
        severity: "CRITICAL",
        foundValue: String(item.lineTotal),
        foundSource: docLabel,
        expectedValue: String(Math.round(expected * 100) / 100),
        expectedSource: "quantity × unit price",
      });
    }
  });

  if (totalValue != null) {
    const sum = items.reduce((s, it) => s + it.lineTotal, 0);
    if (!numbersMatch(sum, totalValue)) {
      out.push({
        field: "Line items sum vs. document total",
        severity: "CRITICAL",
        foundValue: String(Math.round(sum * 100) / 100),
        foundSource: `${docLabel} (sum of line items)`,
        expectedValue: String(totalValue),
        expectedSource: `${docLabel} (stated total)`,
      });
    }
  }
  return out;
}

export function checkDateOrder(
  dated: Array<{ label: string; date: string | null; order: number }>
): Discrepancy[] {
  const out: Discrepancy[] = [];
  const present = dated.filter((d) => d.date != null).sort((a, b) => a.order - b.order);
  for (let i = 1; i < present.length; i++) {
    const prev = present[i - 1];
    const cur = present[i];
    if (normalizeDate(cur.date) != null && normalizeDate(prev.date) != null && cur.date! < prev.date!) {
      out.push({
        field: "Document date order",
        severity: "WARNING",
        foundValue: cur.date,
        foundSource: cur.label,
        expectedValue: `on or after ${prev.date}`,
        expectedSource: prev.label,
      });
    }
  }
  return out;
}

// Low-confidence fields are themselves worth a reviewer's attention, even
// when nothing mismatches outright.
export function lowConfidenceWarnings(extracted: ExtractedDocument, docLabel: string): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const [key, field] of Object.entries(extracted) as Array<[string, ExtractedField<unknown>]>) {
    if (field && field.value != null && field.confidence < LOW_CONFIDENCE) {
      out.push({
        field: `${key} (low-confidence extraction)`,
        severity: "WARNING",
        foundValue: str(field.value),
        foundSource: docLabel,
        expectedValue: null,
        expectedSource: "—",
      });
    }
  }
  return out;
}

export function worstSeverity(discrepancies: Discrepancy[]): Severity | null {
  if (discrepancies.some((d) => d.severity === "CRITICAL")) return "CRITICAL";
  if (discrepancies.some((d) => d.severity === "WARNING")) return "WARNING";
  if (discrepancies.length > 0) return "INFO";
  return null;
}
