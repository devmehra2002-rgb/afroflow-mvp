// Step 4 checks: proforma maths, validation and the PDF. No network, no database.
import { addDays, approvalProblems, defaultProforma, lineAmount, parseQty, proformaNumber, sanitizeProforma, totals, type ProformaData } from "../src/lib/proforma/calc";
import { loadCompany } from "../src/lib/proforma/company";
import { buildProformaPdf } from "../src/lib/proforma/pdf";

let passed = 0, failed = 0;
function check(cond: boolean, label: string) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const order = { id: "AA-2026-021", customerName: "Mombasa Auto Parts Ltd", country: "Kenya", product: "Motorcycle Brake Shoes", qty: "5,000 pcs", value: 18500, terms: "30% advance, 70% against BL" };

async function main() {
  // numbers and dates
  check(proformaNumber("AA-2026-021") === "PI-2026-021", "number from order id");
  check(proformaNumber("AA-2026-021", 2) === "PI-2026-021-R1", "revision suffix");
  check(addDays("2026-10-22", 15) === "2026-11-06", "validity +15 days");
  check(addDays("2026-12-25", 10) === "2027-01-04", "date rolls over the year");

  // quantity parsing
  check(parseQty("5,000 pcs").quantity === 5000 && parseQty("5,000 pcs").unit === "pcs", "5,000 pcs");
  check(parseQty("2 x 40 ft").unit === "units", "'x' is not a unit");
  check(parseQty("25 MT").unit === "MT" && parseQty("25 MT").quantity === 25, "25 MT");
  check(parseQty("lots").quantity === 1, "no number → 1");
  check(parseQty(null).quantity === 1, "null qty → 1");

  // default draft
  const d = defaultProforma(order, "2026-10-22");
  check(d.lines.length === 1 && d.lines[0].quantity === 5000 && d.lines[0].unitPrice === 3.7, "unit price worked out from order value");
  check(totals(d).total === 18500, "default total equals order value");
  check(d.paymentTerms === order.terms && d.buyerName === order.customerName && d.validUntil === "2026-11-06", "prefilled from order");
  check(defaultProforma({ ...order, value: 0 }, "2026-10-22").lines[0].unitPrice === 0, "no value → price 0 (a person must fill it)");

  // maths: no floating point drift
  check(lineAmount({ quantity: 3, unitPrice: 0.1 }) === 0.3, "0.1 x 3 = 0.3");
  check(lineAmount({ quantity: 1.005, unitPrice: 100 }) === 100.5, "rounds to 2 places");
  const two: ProformaData = { ...d, lines: [{ ...d.lines[0], quantity: 10, unitPrice: 12.345 }, { ...d.lines[0], quantity: 2, unitPrice: 99.99 }] };
  check(totals(two).total === 323.43, "sum of lines (123.45 + 199.98)");
  const eur: ProformaData = { ...two, currency: "EUR", exchangeRateToInr: 90 };
  check(totals(eur).inr === 29108.7, "INR equivalent from rate");
  check(totals({ ...two, currency: "EUR", exchangeRateToInr: null }).inr === null, "no rate → no INR line");
  check(totals({ ...two, currency: "INR", exchangeRateToInr: null }).inr === 323.43, "INR invoice: INR total = total");

  // validation
  const good = sanitizeProforma(d);
  check(!!good.data && good.errors.length === 0, "default draft is valid to save");
  const bad = sanitizeProforma({ ...d, currency: "GBP", lines: [] });
  check(!bad.data && bad.errors.length >= 2, "bad currency and no lines rejected");
  check(!sanitizeProforma({ ...d, lines: [{ ...d.lines[0], quantity: 0 }] }).data, "zero quantity rejected");
  check(!sanitizeProforma({ ...d, lines: [{ ...d.lines[0], unitPrice: -5 }] }).data, "negative price rejected");
  check(!sanitizeProforma({ ...d, lines: [{ ...d.lines[0], unitPrice: "abc" }] }).data, "non-number price rejected");
  check(!sanitizeProforma({ ...d, validUntil: "2026-01-01" }).data, "valid-until before issue date rejected");
  check(!sanitizeProforma({ ...d, issueDate: "tomorrow" }).data, "bad date rejected");
  check(!sanitizeProforma({ ...d, exchangeRateToInr: -1 }).data, "negative exchange rate rejected");
  check(sanitizeProforma({ ...d, currency: "INR", exchangeRateToInr: 5 }).data?.exchangeRateToInr === null, "INR invoice drops exchange rate");
  check(sanitizeProforma(null).data === null, "null input rejected");
  const long = sanitizeProforma({ ...d, notes: "x".repeat(5000) });
  check(long.data?.notes.length === 1000, "notes capped at 1000 chars");
  check(sanitizeProforma({ ...d, lines: Array.from({ length: 80 }, () => d.lines[0]) }).data?.lines.length === 30, "lines capped at 30");

  // approval rules
  const priced: ProformaData = { ...d, incoterm: "CIF" };
  check(approvalProblems(priced).length === 0, "complete draft can be approved");
  check(approvalProblems({ ...priced, incoterm: "" }).length === 1, "approval needs incoterm");
  check(approvalProblems({ ...priced, paymentTerms: "" }).length === 1, "approval needs payment terms");
  check(approvalProblems({ ...priced, lines: [{ ...d.lines[0], unitPrice: 0 }] }).length === 1, "approval needs a real unit price");

  // company details come from env, empty ones are dropped
  const co = loadCompany({ COMPANY_ADDRESS: "12 Port Rd\\nMumbai", COMPANY_BANK: "A/C 123\nIFSC X", COMPANY_GSTIN: " 27ABC " });
  check(co.name === "Afro Asiatic Exporters" && co.address.length === 2 && co.bank.length === 2 && co.gstin === "27ABC", "company read from env");
  check(loadCompany({}).address.length === 0 && loadCompany({}).bank.length === 0, "missing env → empty, not crash");

  // the PDF itself
  const company = loadCompany({ COMPANY_ADDRESS: "12 Port Rd, Mumbai", COMPANY_IEC: "0123456789", COMPANY_BANK: "Test Bank\nA/C 000" });
  const pdf = await buildProformaPdf({ number: "PI-2026-021", orderId: "AA-2026-021", data: { ...priced, notes: "Price includes ocean freight. ₹ symbol and “quotes” must not crash." }, company, approved: false });
  check(pdf.length > 1500 && Buffer.from(pdf.slice(0, 5)).toString() === "%PDF-", "draft PDF is a real PDF");
  const approved = await buildProformaPdf({ number: "PI-2026-021", orderId: "AA-2026-021", data: priced, company, approved: true });
  check(Buffer.from(approved.slice(0, 5)).toString() === "%PDF-" && approved.length > 1500, "approved PDF is a real PDF");
  const many = await buildProformaPdf({ number: "PI-X", orderId: "AA-X", data: { ...priced, lines: Array.from({ length: 30 }, (_, i) => ({ ...d.lines[0], description: `Item ${i} ` + "long description ".repeat(8) })) }, company, approved: true });
  check(Buffer.from(many.slice(0, 5)).toString() === "%PDF-", "30-line invoice spills onto more pages without crashing");
  const bare = await buildProformaPdf({ number: "PI-Y", orderId: "AA-Y", data: priced, company: loadCompany({}), approved: true });
  check(bare.length > 1000, "PDF works with no company details set");

  console.log(`proforma tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
