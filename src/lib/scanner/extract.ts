import { validateExtraction, type ExtractedDocument } from "./schema";

export const DEFAULT_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are extracting structured data from a scanned or digital export trade document (such as a Proforma Invoice, Purchase Order, Commercial Invoice, Packing List, or Bill of Lading).

Return ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape. Every top-level key must be present. If a field is not present in the document, its value must be null. Every field that IS present must be an object of the form:
  { "value": <the extracted value>, "confidence": <0 to 1>, "snippet": "<the exact text in the document this was read from>" }

Keys (all required, each either null or a field object as described above):
exporter, buyer, notifyParty, documentNumber, documentDate (ISO yyyy-mm-dd), productDescription, hsnCode, quantity, quantityUnit, containerType ("20ft" or "40ft" only), containerCount, containerNumbers (array of strings), sealNumbers (array of strings), unitPrice, totalValue, currency, incoterms, paymentTerms, portOfLoading, portOfDischarge, countryOfDestination, grossWeight, netWeight, numberOfPackages, lineItems (array of {description, hsnCode, quantity, unitPrice, lineTotal}).

Read every page. Do not guess values that are not actually present — use null and a low confidence instead. The snippet must be copied verbatim from the document, not paraphrased.`;

// Minimal shape of the Anthropic client this module actually uses — lets
// tests pass a mock without depending on the real SDK or network access.
export interface AnthropicLike {
  messages: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (params: any) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface ExtractionResult {
  success: boolean;
  data: ExtractedDocument | null;
  error: string | null;
  rawResponse: string | null;
  attempts: number;
}

function extractJsonBlock(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) return fence[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1) return text.slice(first, last + 1);
  return text;
}

export async function extractDocument(params: {
  client: AnthropicLike;
  model?: string;
  docType: string;
  base64: string;
  mediaType: string;
}): Promise<ExtractionResult> {
  const { client, model = DEFAULT_MODEL, docType, base64, mediaType } = params;
  const isPdf = mediaType === "application/pdf";

  async function attempt(): Promise<string> {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
              : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: `Document type: ${docType}. Extract the fields as instructed.` },
          ],
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text ?? "";
  }

  let lastRaw: string | null = null;
  const maxAttempts = 2; // one retry on invalid JSON / schema mismatch
  for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
    let raw: string;
    try {
      raw = await attempt();
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `AI request failed: ${e instanceof Error ? e.message : String(e)}`,
        rawResponse: lastRaw,
        attempts: attemptNum,
      };
    }
    lastRaw = raw;
    try {
      const parsed = JSON.parse(extractJsonBlock(raw));
      const validated = validateExtraction(parsed);
      if (validated.success) {
        return { success: true, data: validated.data, error: null, rawResponse: raw, attempts: attemptNum };
      }
    } catch {
      // invalid JSON — fall through to retry
    }
  }
  return {
    success: false,
    data: null,
    error: "AI response did not match the expected schema after one retry.",
    rawResponse: lastRaw,
    attempts: maxAttempts,
  };
}
