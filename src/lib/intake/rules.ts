import crypto from "crypto";
import type { Enquiry } from "./extract";
import { CONFIDENCE_THRESHOLD, ORDER_ID_PATTERN } from "./constants";

// AI reads, rules decide, humans approve. Everything in this file is plain
// code: no AI, no guessing, same input always gives the same answer.

// ---- header secret: constant-time compare ----
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(provided), h(expected));
}

// ---- "Dev Mehra <dev@x.com>" or "dev@x.com" ----
export function parseSender(from: string): { email: string | null; name: string | null } {
  const raw = (from ?? "").trim();
  const angle = /^(.*?)<([^<>]+)>\s*$/.exec(raw);
  const email = (angle ? angle[2] : raw).trim().toLowerCase();
  const name = angle ? angle[1].replace(/^["'\s]+|["'\s]+$/g, "") || null : null;
  return { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, name };
}

export interface OpenOrderRef { id: string; customerId: string | null }

export interface RouteInput {
  extraction: Enquiry | null;
  extractionError?: string | null;
  text: string;                                   // subject + body, for finding order numbers
  customer: { id: string; name: string } | null; // matched by exact sender email
  openOrders: OpenOrderRef[];                     // this customer's unfinished orders
  previousOrderUnresolved?: boolean;              // says "same as last order" but there is none
  threshold?: number;
}

export type InquiryStatus = "NEW_CUSTOMER" | "EXISTING_CUSTOMER" | "ORDER_UPDATE" | "NEEDS_REVIEW";
export interface RouteResult { status: InquiryStatus; routeReason: string; orderId?: string }

export function findOrderReference(text: string, aiReference: string | null | undefined, openOrders: OpenOrderRef[]): string | null {
  const mentioned = new Set<string>();
  for (const m of text.match(ORDER_ID_PATTERN) ?? []) mentioned.add(m.toUpperCase());
  if (aiReference) for (const m of aiReference.match(ORDER_ID_PATTERN) ?? []) mentioned.add(m.toUpperCase());
  const open = new Set(openOrders.map((o) => o.id.toUpperCase()));
  for (const id of mentioned) if (open.has(id)) return openOrders.find((o) => o.id.toUpperCase() === id)!.id;
  return null;
}

// The rules, in order. The first one that applies wins.
export function routeInquiry(input: RouteInput): RouteResult {
  const threshold = input.threshold ?? CONFIDENCE_THRESHOLD;
  const { extraction, customer } = input;

  // 1. If the AI step failed, a person looks at it. Nothing is lost.
  if (!extraction) {
    return { status: "NEEDS_REVIEW", routeReason: `Could not read this email automatically (${input.extractionError ?? "AI step failed"}).` };
  }

  // 2. A known customer clearly pointing at one of their own open orders:
  //    it goes into that order's activity log.
  if (customer) {
    const orderId = findOrderReference(input.text, extraction.orderReference, input.openOrders);
    if (orderId) {
      return { status: "ORDER_UPDATE", orderId, routeReason: `${customer.name} mentioned open order ${orderId}, so it was added to that order's activity log.` };
    }
  }

  // 3. Not a buyer enquiry (newsletter, spam, invoice...).
  if (!extraction.isBuyerEnquiry.value) {
    return { status: "NEEDS_REVIEW", routeReason: "Not recognised as a buyer enquiry." };
  }

  // 4. Not sure enough.
  if (extraction.overallConfidence < threshold) {
    return { status: "NEEDS_REVIEW", routeReason: `Overall confidence ${extraction.overallConfidence.toFixed(2)} is below the ${threshold} threshold.` };
  }

  // 5. "Same as last order" but there is no last order to copy from.
  if (input.previousOrderUnresolved) {
    return { status: "NEEDS_REVIEW", routeReason: "Refers to a previous order, but no earlier order was found for this sender." };
  }

  // 6. Sender matches a known customer: their folder. Otherwise: the new-inquiry board.
  if (customer) return { status: "EXISTING_CUSTOMER", routeReason: `Sender email matches existing customer ${customer.name}.` };
  return { status: "NEW_CUSTOMER", routeReason: "Sender email matches no known customer." };
}

// "Same brake shoes as last order": if the AI could not name a product with
// enough confidence, copy it from this customer's most recent order and mark it
// as inferred, so the person approving can see it was filled in by a rule.
export function applyPreviousOrderRule(
  enquiry: Enquiry,
  lastOrderProduct: string | null,
  threshold = CONFIDENCE_THRESHOLD
): { fields: Enquiry["fields"]; productInferred: boolean; unresolved: boolean } {
  const product = enquiry.fields.product;
  const weak = !product || product.value == null || product.confidence < threshold;
  if (!enquiry.refersToPreviousOrder || !weak) return { fields: enquiry.fields, productInferred: false, unresolved: false };
  if (!lastOrderProduct) return { fields: enquiry.fields, productInferred: false, unresolved: true };
  return {
    fields: { ...enquiry.fields, product: { value: lastOrderProduct, confidence: 0.8, snippet: null } },
    productInferred: true,
    unresolved: false,
  };
}
