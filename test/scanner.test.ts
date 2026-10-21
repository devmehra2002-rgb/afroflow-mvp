// Tests for the document scanner's deterministic logic: schema validation,
// normalization, and comparison. No live Claude API calls are made anywhere
// here — extraction results are hand-crafted to mimic what the AI would
// return, exactly as the brief asks for.
import { validateExtraction, type ExtractedDocument } from "../src/lib/scanner/schema";
import {
  normalizeCompanyName,
  normalizeNumber,
  normalizeCurrency,
  normalizeDate,
  normalizeContainerType,
  numbersMatch,
} from "../src/lib/scanner/normalize";
import {
  compareDocumentToOrder,
  compareDocuments,
  checkLineItemMath,
  checkDateOrder,
  lowConfidenceWarnings,
  worstSeverity,
  type OrderRecord,
} from "../src/lib/scanner/compare";

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}
function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else { failed++; console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

function f<T>(value: T | null, confidence = 0.95, snippet = "snippet") {
  return { value, confidence, snippet };
}

// Fills in every schema field as null so each test only has to specify what
// it cares about.
function blankDoc(overrides: Partial<ExtractedDocument> = {}): ExtractedDocument {
  const base: ExtractedDocument = {
    exporter: null, buyer: null, notifyParty: null, documentNumber: null, documentDate: null,
    productDescription: null, hsnCode: null, quantity: null, quantityUnit: null,
    containerType: null, containerCount: null, containerNumbers: null, sealNumbers: null,
    unitPrice: null, totalValue: null, currency: null, incoterms: null, paymentTerms: null,
    portOfLoading: null, portOfDischarge: null, countryOfDestination: null,
    grossWeight: null, netWeight: null, numberOfPackages: null, lineItems: null,
  };
  return { ...base, ...overrides };
}

// ---- Schema validation ----
{
  const valid = blankDoc({ buyer: f("Velez Trading Co"), totalValue: f(50000) });
  assert(validateExtraction(valid).success, "well-formed extraction passes validation");
}
{
  const invalid = { buyer: "Velez Trading Co" }; // not wrapped in {value, confidence, snippet}
  assert(!validateExtraction(invalid).success, "malformed extraction (raw string instead of field object) fails validation");
}
{
  const invalid = blankDoc({ containerType: { value: "60ft" as never, confidence: 0.9, snippet: "x" } });
  assert(!validateExtraction(invalid).success, "containerType outside the enum fails validation");
}

// ---- Normalization ----
assertEqual(normalizeCompanyName("Velez Trading Co Pvt. Ltd."), normalizeCompanyName("Velez Trading Co Private Limited"), "company suffix variants normalize the same");
assertEqual(normalizeNumber("1,234.56"), 1234.56, "comma-thousands number parses correctly");
assertEqual(normalizeNumber("1.234,56"), 1234.56, "European-style number parses correctly");
assertEqual(normalizeCurrency("$"), "USD", "currency symbol maps to ISO code");
assertEqual(normalizeCurrency("US$"), "USD", "currency shorthand maps to ISO code");
assertEqual(normalizeDate("15/03/2026"), "2026-03-15", "dd/mm/yyyy date normalizes to ISO");
assertEqual(normalizeContainerType("40 FT"), "40ft", "container type text normalizes to enum value");
assert(numbersMatch(50000, 50001), "numbers within tolerance are treated as matching");
assert(!numbersMatch(50000, 45000), "numbers outside tolerance are treated as mismatching");

// ---- Document vs. order ----
const order: OrderRecord = {
  id: "AA-2026-021",
  customer: "Velez Trading Co",
  product: "Soda Ash Dense",
  containerType: "20ft",
  containerCount: 3,
  value: 50000,
  currency: "USD",
  shipDate: "2026-10-15",
};

{
  const matching = blankDoc({
    buyer: f("Velez Trading Co Pvt Ltd"), // suffix difference only
    containerType: f("20ft"),
    containerCount: f(3),
    totalValue: f(50000),
    currency: f("USD"),
  });
  const discrepancies = compareDocumentToOrder(matching, "Commercial Invoice", order);
  assertEqual(discrepancies, [], "matching document (after normalization) produces no discrepancies against the order");
}
{
  // Deliberate error: wrong container count.
  const wrongContainers = blankDoc({ buyer: f("Velez Trading Co"), containerCount: f(5) });
  const discrepancies = compareDocumentToOrder(wrongContainers, "Commercial Invoice", order);
  assert(discrepancies.some((d) => d.field === "Number of Containers" && d.severity === "CRITICAL"), "container count mismatch is flagged CRITICAL");
}
{
  // Deliberate error: wrong total value.
  const wrongTotal = blankDoc({ totalValue: f(45000) });
  const discrepancies = compareDocumentToOrder(wrongTotal, "Commercial Invoice", order);
  assert(discrepancies.some((d) => d.field === "Total Value" && d.severity === "CRITICAL"), "value mismatch is flagged CRITICAL");
}
{
  const wrongConsignee = blankDoc({ buyer: f("Someone Else Trading") });
  const discrepancies = compareDocumentToOrder(wrongConsignee, "Commercial Invoice", order);
  assert(discrepancies.some((d) => d.field === "Buyer / Consignee" && d.severity === "CRITICAL"), "consignee mismatch is flagged CRITICAL");
}
{
  const minorNameDiff = blankDoc({ productDescription: f("Soda Ash, Dense Grade") });
  const discrepancies = compareDocumentToOrder(minorNameDiff, "Commercial Invoice", order);
  assert(discrepancies.some((d) => d.field === "Product Description" && d.severity === "WARNING"), "product name variation is flagged WARNING, not CRITICAL");
}

// ---- Document vs. document ----
{
  const pi = { label: "Proforma Invoice", extracted: blankDoc({ hsnCode: f("2836.20"), containerType: f("20ft") }) };
  const po = { label: "Purchase Order", extracted: blankDoc({ hsnCode: f("2836.30"), containerType: f("20ft") }) }; // deliberate HSN mismatch
  const discrepancies = compareDocuments([pi, po]);
  assert(discrepancies.some((d) => d.field === "HSN Code" && d.severity === "CRITICAL"), "HSN code mismatch between two documents is flagged CRITICAL");
  assert(!discrepancies.some((d) => d.field === "Container Type"), "matching container type between documents produces no discrepancy");
}

// ---- Internal math checks ----
{
  const correctItems = [{ description: "Soda Ash", hsnCode: "2836.20", quantity: 60, unitPrice: 833.33, lineTotal: 50000 }];
  assertEqual(checkLineItemMath(correctItems, "Commercial Invoice", 50000), [], "correct line-item math produces no discrepancies");
}
{
  // Deliberate error: quantity × unit price does not equal the stated line total.
  const wrongLineTotal = [{ description: "Soda Ash", hsnCode: "2836.20", quantity: 60, unitPrice: 833.33, lineTotal: 60000 }];
  const discrepancies = checkLineItemMath(wrongLineTotal, "Commercial Invoice", 60000);
  assert(discrepancies.some((d) => d.severity === "CRITICAL" && d.field.includes("Line 1")), "quantity × unit price mismatch is flagged CRITICAL");
}
{
  const items = [
    { description: "Soda Ash", hsnCode: "2836.20", quantity: 60, unitPrice: 500, lineTotal: 30000 },
    { description: "Packing", hsnCode: "2836.20", quantity: 1, unitPrice: 1000, lineTotal: 1000 },
  ];
  // Deliberate error: stated total doesn't match sum of line totals (31000).
  const discrepancies = checkLineItemMath(items, "Commercial Invoice", 50000);
  assert(discrepancies.some((d) => d.field === "Line items sum vs. document total"), "line-item sum vs. stated total mismatch is flagged");
}

// ---- Date order ----
{
  const outOfOrder = [
    { label: "Proforma Invoice", date: "2026-09-10", order: 0 },
    { label: "Purchase Order", date: "2026-09-05", order: 1 }, // before the proforma invoice — suspicious
  ];
  const discrepancies = checkDateOrder(outOfOrder);
  assert(discrepancies.some((d) => d.severity === "WARNING"), "out-of-order document dates are flagged WARNING");
}
{
  const inOrder = [
    { label: "Proforma Invoice", date: "2026-09-05", order: 0 },
    { label: "Purchase Order", date: "2026-09-10", order: 1 },
  ];
  assertEqual(checkDateOrder(inOrder), [], "in-order document dates produce no discrepancy");
}

// ---- Low-confidence flags ----
{
  const lowConf = blankDoc({ hsnCode: f("2836.20", 0.4) });
  const discrepancies = lowConfidenceWarnings(lowConf, "Commercial Invoice");
  assert(discrepancies.some((d) => d.severity === "WARNING"), "a low-confidence extracted field is flagged WARNING even with no mismatch");
}

// ---- Severity precedence ----
assertEqual(worstSeverity([{ field: "a", severity: "WARNING", foundValue: null, foundSource: "x", expectedValue: null, expectedSource: "y" }, { field: "b", severity: "CRITICAL", foundValue: null, foundSource: "x", expectedValue: null, expectedSource: "y" }]), "CRITICAL", "worst severity picks CRITICAL over WARNING");
assertEqual(worstSeverity([]), null, "worst severity of no discrepancies is null (clean)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
