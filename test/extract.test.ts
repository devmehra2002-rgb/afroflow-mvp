// Tests the extraction retry/validation logic with a MOCKED Anthropic
// client — no network access or API key required, per the brief's test
// requirement.
import { extractDocument, type AnthropicLike } from "../src/lib/scanner/extract";

let passed = 0, failed = 0;
async function check(cond: boolean, label: string) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const VALID_JSON = JSON.stringify({
  exporter: null, buyer: { value: "Velez Trading Co", confidence: 0.95, snippet: "Velez Trading Co" },
  notifyParty: null, documentNumber: null, documentDate: null, productDescription: null,
  hsnCode: null, quantity: null, quantityUnit: null, containerType: null, containerCount: null,
  containerNumbers: null, sealNumbers: null, unitPrice: null,
  totalValue: { value: 50000, confidence: 0.9, snippet: "USD 50,000" },
  currency: null, incoterms: null, paymentTerms: null, portOfLoading: null, portOfDischarge: null,
  countryOfDestination: null, grossWeight: null, netWeight: null, numberOfPackages: null, lineItems: null,
});

function mockClient(responses: string[]): AnthropicLike {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const text = responses[Math.min(call, responses.length - 1)];
        call++;
        return { content: [{ type: "text", text }] };
      },
    },
  };
}

async function run() {
  // A clean valid response on the first attempt succeeds without retrying.
  {
    const client = mockClient([VALID_JSON]);
    const result = await extractDocument({ client, docType: "Commercial Invoice", base64: "x", mediaType: "application/pdf" });
    await check(result.success === true, "valid first response succeeds");
    await check(result.attempts === 1, "no retry needed when the first response is valid");
    await check(result.data?.buyer?.value === "Velez Trading Co", "extracted field value is readable on success");
  }

  // Malformed JSON on the first attempt, valid on the retry — succeeds via the single retry.
  {
    const client = mockClient(["not valid json at all", VALID_JSON]);
    const result = await extractDocument({ client, docType: "Commercial Invoice", base64: "x", mediaType: "application/pdf" });
    await check(result.success === true, "invalid JSON on attempt 1, valid on retry succeeds");
    await check(result.attempts === 2, "exactly one retry was used");
  }

  // JSON wrapped in a markdown fence is still parsed correctly.
  {
    const fenced = "Here you go:\n```json\n" + VALID_JSON + "\n```";
    const client = mockClient([fenced]);
    const result = await extractDocument({ client, docType: "Commercial Invoice", base64: "x", mediaType: "application/pdf" });
    await check(result.success === true, "JSON inside a markdown fence is extracted and parsed");
  }

  // Invalid both times -> fails gracefully, never throws.
  {
    const client = mockClient(["garbage", "still garbage"]);
    const result = await extractDocument({ client, docType: "Commercial Invoice", base64: "x", mediaType: "application/pdf" });
    await check(result.success === false, "invalid JSON on both attempts fails gracefully");
    await check(typeof result.error === "string" && result.error.length > 0, "a failure includes a readable error message");
    await check(result.attempts === 2, "fails only after using both attempts");
  }

  // Valid JSON but violates the schema (bad enum value) on both attempts -> fails gracefully.
  {
    const invalidEnum = JSON.parse(VALID_JSON);
    invalidEnum.containerType = { value: "60ft", confidence: 0.9, snippet: "60FT" };
    const client = mockClient([JSON.stringify(invalidEnum), JSON.stringify(invalidEnum)]);
    const result = await extractDocument({ client, docType: "Commercial Invoice", base64: "x", mediaType: "application/pdf" });
    await check(result.success === false, "schema-violating response (bad enum) fails gracefully after retry");
  }

  // A thrown network/API error surfaces as a clean failure, not an unhandled exception.
  {
    const client: AnthropicLike = { messages: { create: async () => { throw new Error("rate limited"); } } };
    const result = await extractDocument({ client, docType: "Commercial Invoice", base64: "x", mediaType: "application/pdf" });
    await check(result.success === false, "a thrown API error is caught and returned as a failure");
    await check(!!result.error?.includes("rate limited"), "the underlying error message is preserved");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run();
