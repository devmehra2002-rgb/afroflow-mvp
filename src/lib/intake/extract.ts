import fs from "fs";
import path from "path";
import { z } from "zod";
import { DEFAULT_MODEL, MAX_BODY_CHARS } from "./constants";

// ---- The prompt lives in /prompts so it is versioned in git ----
export function loadPrompt(): { text: string; version: string } {
  const raw = fs.readFileSync(path.join(process.cwd(), "prompts", "extract-enquiry.md"), "utf8");
  const m = /^version:\s*(.+)$/m.exec(raw);
  return { text: raw.replace(/^version:.*\n/, "").trim(), version: m ? m[1].trim() : "unknown" };
}

// ---- Strict shape of what the AI must return ----
const field = <T extends z.ZodTypeAny>(v: T) =>
  z
    .object({ value: v, confidence: z.number().min(0).max(1), snippet: z.string().nullable().optional() })
    .nullable();

export const enquirySchema = z.object({
  isBuyerEnquiry: z.object({ value: z.boolean(), confidence: z.number().min(0).max(1) }),
  overallConfidence: z.number().min(0).max(1),
  refersToPreviousOrder: z.boolean(),
  orderReference: z.string().nullable(),
  fields: z.object({
    customerName: field(z.string()),
    product: field(z.string()),
    quantity: field(z.string()),
    containerType: field(z.enum(["20ft", "40ft"])),
    containerCount: field(z.number()),
    incoterm: field(z.string()),
    destinationPort: field(z.string()),
    deadline: field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  }),
});
export type Enquiry = z.infer<typeof enquirySchema>;

export interface AnthropicLike {
  messages: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (params: any) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface ExtractResult {
  success: boolean;
  data: Enquiry | null;
  error: string | null;
  attempts: number;
}

function jsonBlock(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) return fence[1];
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  return a !== -1 && b !== -1 ? text.slice(a, b + 1) : text;
}

export async function extractEnquiry(params: {
  client: AnthropicLike;
  model?: string;
  prompt: string;
  from: string;
  subject: string;
  body: string;
  today: string; // YYYY-MM-DD
}): Promise<ExtractResult> {
  const { client, model = DEFAULT_MODEL, prompt, from, subject, body, today } = params;
  const email = `Today's date: ${today}\n\n<email>\nFrom: ${from}\nSubject: ${subject}\n\n${body.slice(0, MAX_BODY_CHARS)}\n</email>`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let text = "";
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 1500,
        system: prompt,
        messages: [{ role: "user", content: email }],
      });
      text = res.content.find((b) => b.type === "text")?.text ?? "";
    } catch (e) {
      return { success: false, data: null, error: `AI request failed: ${e instanceof Error ? e.message : String(e)}`, attempts: attempt };
    }
    try {
      const parsed = enquirySchema.safeParse(JSON.parse(jsonBlock(text)));
      if (parsed.success) return { success: true, data: parsed.data, error: null, attempts: attempt };
    } catch {
      /* invalid JSON: retry once */
    }
  }
  return { success: false, data: null, error: "AI answer was not valid after one retry.", attempts: 2 };
}
