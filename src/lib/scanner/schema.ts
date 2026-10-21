import { z } from "zod";

// Every extracted field carries its own confidence and the exact text it was
// read from, so a reviewer (or the discrepancy panel) can see why the AI
// believes a given value is correct.
function field<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      value: valueSchema.nullable(),
      confidence: z.number().min(0).max(1),
      snippet: z.string().nullable(),
    })
    .nullable();
}

export const lineItemSchema = z.object({
  description: z.string(),
  hsnCode: z.string().nullable(),
  quantity: z.number(),
  unitPrice: z.number(),
  lineTotal: z.number(),
});

// The strict shape every extraction must conform to. Nothing here is free
// text — every field is either absent, or a typed value with provenance.
export const extractedDocumentSchema = z.object({
  exporter: field(z.string()),
  buyer: field(z.string()),
  notifyParty: field(z.string()),
  documentNumber: field(z.string()),
  documentDate: field(z.string()), // ISO yyyy-mm-dd
  productDescription: field(z.string()),
  hsnCode: field(z.string()),
  quantity: field(z.number()),
  quantityUnit: field(z.string()),
  containerType: field(z.enum(["20ft", "40ft"])),
  containerCount: field(z.number()),
  containerNumbers: field(z.array(z.string())),
  sealNumbers: field(z.array(z.string())),
  unitPrice: field(z.number()),
  totalValue: field(z.number()),
  currency: field(z.string()),
  incoterms: field(z.string()),
  paymentTerms: field(z.string()),
  portOfLoading: field(z.string()),
  portOfDischarge: field(z.string()),
  countryOfDestination: field(z.string()),
  grossWeight: field(z.number()),
  netWeight: field(z.number()),
  numberOfPackages: field(z.number()),
  lineItems: field(z.array(lineItemSchema)),
});

export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;
export type ExtractedField<T> = { value: T | null; confidence: number; snippet: string | null } | null;
export type LineItem = z.infer<typeof lineItemSchema>;

export function validateExtraction(raw: unknown) {
  return extractedDocumentSchema.safeParse(raw);
}

export const EXTRACTION_FIELD_NAMES = Object.keys(extractedDocumentSchema.shape) as Array<
  keyof ExtractedDocument
>;
