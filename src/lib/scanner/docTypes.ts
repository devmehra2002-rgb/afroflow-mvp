// Maps between the Prisma enum and the exact document-type label strings
// already used by the static site's DOCUMENT_TASK_LINKS config, so the two
// systems speak the same language without either one changing its naming.
export const DOC_TYPE_LABELS = {
  PROFORMA_INVOICE: "Proforma Invoice",
  PURCHASE_ORDER: "Purchase Order",
  COMMERCIAL_INVOICE: "Commercial Invoice",
  PACKING_LIST: "Packing List",
  BILL_OF_LADING: "Bill of Lading",
} as const;

export type SupportedDocType = keyof typeof DOC_TYPE_LABELS;

export const SUPPORTED_DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as SupportedDocType[];

const LABEL_TO_ENUM = Object.fromEntries(
  Object.entries(DOC_TYPE_LABELS).map(([k, v]) => [v, k])
) as Record<string, SupportedDocType>;

export function labelToDocType(label: string): SupportedDocType | null {
  return LABEL_TO_ENUM[label] ?? null;
}

// Order in the real-world document flow, used for the date-order check.
export const DOC_TYPE_SEQUENCE: Record<SupportedDocType, number> = {
  PROFORMA_INVOICE: 0,
  PURCHASE_ORDER: 1,
  COMMERCIAL_INVOICE: 2,
  PACKING_LIST: 3,
  BILL_OF_LADING: 4,
};

export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
export const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
