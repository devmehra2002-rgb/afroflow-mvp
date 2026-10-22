import fs from "fs";
import path from "path";
import { z } from "zod";
import { DEFAULT_MODEL, MAX_BODY_CHARS } from "@/lib/intake/constants";
import type { AnthropicLike } from "@/lib/intake/extract";

export function loadCallPrompt(): { text: string; version: string } {
  const raw = fs.readFileSync(path.join(process.cwd(), "prompts", "extract-call.md"), "utf8");
  const m = /^version:\s*(.+)$/m.exec(raw);
  return { text: raw.replace(/^version:.*\n/, "").trim(), version: m ? m[1].trim() : "unknown" };
}

const field = z.object({ value: z.string(), confidence: z.number().min(0).max(1), snippet: z.string().nullable().optional() }).nullable();

export const callDetailsSchema = z.object({
  spokeWithBuyer: z.boolean(),
  buyerCompany: field, contactPerson: field, buyerAddress: field, buyerPhone: field, buyerEmail: field,
  destinationPort: field, incoterm: field, paymentTerms: field, product: field, quantity: field, deliveryTime: field, notes: field,
});
export type CallDetails = z.infer<typeof callDetailsSchema>;

// The details a person reviews, in the order shown on screen.
export const CALL_FIELDS: [keyof Omit<CallDetails, "spokeWithBuyer">, string][] = [
  ["buyerCompany", "Company"], ["contactPerson", "Contact person"], ["buyerAddress", "Address"], ["buyerPhone", "Phone"], ["buyerEmail", "Email"],
  ["destinationPort", "Destination port"], ["incoterm", "Incoterm"], ["paymentTerms", "Payment terms"], ["product", "Product"],
  ["quantity", "Quantity"], ["deliveryTime", "Delivery time"], ["notes", "Notes"],
];

function jsonBlock(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) return fence[1];
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  return a !== -1 && b !== -1 ? text.slice(a, b + 1) : text;
}

export async function extractCallDetails(params: { client: AnthropicLike; model?: string; prompt: string; transcript: string }): Promise<{ data: CallDetails | null; error: string | null }> {
  const { client, model = DEFAULT_MODEL, prompt, transcript } = params;
  let lastError = "AI returned nothing";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client.messages.create({
        model, max_tokens: 1500, system: prompt,
        messages: [{ role: "user", content: `<transcript>\n${transcript.slice(0, MAX_BODY_CHARS)}\n</transcript>` }],
      });
      const text = res.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = callDetailsSchema.safeParse(JSON.parse(jsonBlock(text)));
      if (parsed.success) return { data: parsed.data, error: null };
      lastError = "AI answer did not match the expected shape";
    } catch (e) {
      lastError = e instanceof Error ? e.message : "AI call failed";
    }
  }
  return { data: null, error: lastError };
}

// What a person saves after reviewing: plain strings, one per field.
export type AppliedDetails = Partial<Record<(typeof CALL_FIELDS)[number][0], string>>;

export function cleanApplied(raw: unknown): AppliedDetails {
  const out: AppliedDetails = {};
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const [k] of CALL_FIELDS) {
    const v = typeof r[k] === "string" ? (r[k] as string).trim().slice(0, k === "buyerAddress" || k === "notes" ? 600 : 200) : "";
    if (v) out[k] = v;
  }
  return out;
}
