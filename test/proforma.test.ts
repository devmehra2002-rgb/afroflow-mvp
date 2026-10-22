// Step 4 checks: proforma maths, validation and the PDF. No network, no database.
import { addDays, amountInWords, approvalProblems, baseNumber, defaultProforma, fileSafe, financialYear, lineAmount, parsePastedItems, parseQty, proformaNumber, revisedNumber, sanitizeProforma, totals, wholeToWords, type ProformaData } from "../src/lib/proforma/calc";
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
  check(proformaNumber("PI", "2026-08-13", 101) === "PI/2026-27/101", "number format PREFIX/financial-year/sequence");
  check(proformaNumber("PI", "2027-02-01", 7) === "PI/2026-27/7", "Jan-Mar belongs to the previous financial year");
  check(financialYear("2026-04-01") === "2026-27" && financialYear("2026-03-31") === "2025-26", "financial year boundary at 1 April");
  check(financialYear("2099-06-01") === "2099-00", "century wrap formats as 2 digits");
  check(proformaNumber("PI", "2026-10-22", 102, 2) === "PI/2026-27/102-R1", "revision suffix");
  check(baseNumber("PI/2026-27/102-R3") === "PI/2026-27/102" && revisedNumber("PI/2026-27/102-R1", 3) === "PI/2026-27/102-R2", "revision numbers rebuilt from the base");
  check(revisedNumber("PI/2026-27/102-R1", 1) === "PI/2026-27/102", "version 1 has no suffix");
  check(fileSafe("PI/2026-27/102-R1") === "PI-2026-27-102-R1", "slashes made safe for file names");
  check(addDays("2026-10-22", 30) === "2026-11-21", "validity +30 days");
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
  check(d.paymentTerms === order.terms && d.buyerName === order.customerName && d.validUntil === "2026-11-21", "prefilled from order");
  check(d.countryOfOrigin === "India" && d.shipmentMode === "By sea" && d.termsText.length > 20 && d.packing === "", "standard terms text prefilled, packing left for a person");
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
  check(!sanitizeProforma({ ...d, lines: [{ heading: true, description: "ONLY A HEADING" }] }).data, "an invoice of only headings is rejected");
  check(!sanitizeProforma({ ...d, lines: [...d.lines, { heading: true, description: "" }] }).data, "empty heading rejected");
  check(!sanitizeProforma({ ...d, validUntil: "2026-01-01" }).data, "valid-until before issue date rejected");
  check(!sanitizeProforma({ ...d, issueDate: "tomorrow" }).data, "bad date rejected");
  check(!sanitizeProforma({ ...d, exchangeRateToInr: -1 }).data, "negative exchange rate rejected");
  check(sanitizeProforma({ ...d, currency: "INR", exchangeRateToInr: 5 }).data?.exchangeRateToInr === null, "INR invoice drops exchange rate");
  check(sanitizeProforma(null).data === null, "null input rejected");
  const long = sanitizeProforma({ ...d, notes: "x".repeat(5000) });
  check(long.data?.notes.length === 1000, "notes capped at 1000 chars");
  check(sanitizeProforma({ ...d, buyerPhone: "+886 977 254 117", buyerEmail: "a@b.co", buyerRef: "WHATSAPP" }).data?.buyerRef === "WHATSAPP", "buyer phone, email and reference are kept");
  check(sanitizeProforma({ ...d, lines: Array.from({ length: 1500 }, () => d.lines[0]) }).data?.lines.length === 1000, "lines capped at 1000");
  check(sanitizeProforma({ ...d, lines: Array.from({ length: 450 }, () => d.lines[0]) }).data?.lines.length === 450, "450 lines are fine (real invoices have hundreds)");

  // approval rules
  const priced: ProformaData = { ...d, incoterm: "CIF" };
  check(approvalProblems(priced).length === 0, "complete draft can be approved");
  check(approvalProblems({ ...priced, incoterm: "" }).length === 1, "approval needs incoterm");
  check(approvalProblems({ ...priced, paymentTerms: "" }).length === 1, "approval needs payment terms");
  check(approvalProblems({ ...priced, lines: [{ ...d.lines[0], unitPrice: 0 }] }).length === 1, "approval needs a real unit price");
  check(approvalProblems({ ...priced, lines: [{ heading: true, code: "", description: "SECTION A", hsn: "", quantity: 0, unit: "", unitPrice: 0 }, d.lines[0]] }).length === 0, "headings need no price");
  check(approvalProblems({ ...priced, lines: Array.from({ length: 9 }, () => ({ ...d.lines[0], unitPrice: 0 })) }).length === 4, "many missing prices are summarised, not listed 9 times");

  // headings and totals
  const withHeads: ProformaData = { ...d, lines: [{ heading: true, code: "", description: "SECTION A", hsn: "", quantity: 0, unit: "", unitPrice: 0 }, { code: "A1", description: "Gadget", hsn: "", quantity: 100, unit: "pcs", unitPrice: 0.2 }, { heading: true, code: "", description: "SECTION B", hsn: "", quantity: 9, unit: "", unitPrice: 9 }, { code: "B2", description: "Widget", hsn: "", quantity: 30, unit: "pcs", unitPrice: 0.3 }] };
  check(totals(withHeads).total === 29, "headings add nothing to the total (even if they carry numbers)");
  check(lineAmount({ heading: true, quantity: 5, unitPrice: 5 }) === 0, "a heading has no amount");

  // total in words
  check(wholeToWords(1234) === "One Thousand Two Hundred Thirty Four", "1,234 in words");
  check(amountInWords(1234.56, "USD") === "USD One Thousand Two Hundred Thirty Four & Cents Fifty Six Only", "dollars and cents in words");
  check(amountInWords(100, "USD") === "USD One Hundred Only", "no cents → just Only");
  check(amountInWords(0.05, "USD") === "USD Zero & Cents Five Only", "under one dollar");
  check(amountInWords(1000000, "USD") === "USD One Million Only" && amountInWords(1001001, "USD") === "USD One Million One Thousand One Only", "millions");
  check(amountInWords(1234567, "INR") === "INR Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only", "rupees use lakh/crore");
  check(amountInWords(250000050.25, "INR") === "INR Twenty Five Crore Fifty & Paise Twenty Five Only", "crores and paise");
  check(amountInWords(19.99, "EUR") === "EUR Nineteen & Cents Ninety Nine Only", "rounding-safe cents");
  check(amountInWords(-5, "USD") === "USD Zero Only", "negative never printed");

  // pasting items from Excel
  const pasted = parsePastedItems("SECTION A\nCODE-001\tWIDGET ONE\t40\t0.2\nCODE-002\tWIDGET TWO\t30\t0.3\n\nSECTION B\nBADROW\tNO QTY\t\t1\nGADGET\t10\t2.5");
  check(pasted.lines.length === 5 && pasted.skipped === 1, "paste: 2 headings, 3 items, 1 bad row skipped");
  check(pasted.lines[0].heading === true && pasted.lines[0].description === "SECTION A", "paste: single cell becomes a heading");
  check(pasted.lines[1].code === "CODE-001" && pasted.lines[1].quantity === 40 && pasted.lines[1].unitPrice === 0.2, "paste: 4 columns = code, description, qty, price");
  check(pasted.lines[4].description === "GADGET" && pasted.lines[4].code === "" && pasted.lines[4].unitPrice === 2.5, "paste: 3 columns = description, qty, price");
  check(parsePastedItems("A\tB\t1,200\t1,5.5").lines.length === 0 && parsePastedItems("A\tB\t1\t1,5").lines.length === 0, "paste: ambiguous 1,5 is refused, never guessed as 15");
  check(parsePastedItems("A\tB\t1,200\t1,234.50").lines[0]?.quantity === 1200 && parsePastedItems("A\tB\t1\tN/A").lines.length === 0, "paste: real thousands separators work, N/A skipped");
  check(parsePastedItems("\t\tjunk\t").lines.length === 0 && parsePastedItems("\t\tjunk\t").skipped === 1, "paste: a stray cell in a number column is skipped, not turned into a heading");
  check(parsePastedItems("\tSECTION X").lines[0]?.heading === true, "paste: a lone cell in the description column is still a heading");
  check(parsePastedItems("").lines.length === 0 && parsePastedItems(null as unknown as string).lines.length === 0, "paste: empty input is fine");
  check(parsePastedItems(Array.from({ length: 1200 }, (_, i) => `C${i}\tItem\t1\t1`).join("\n")).lines.length === 1000, "paste: capped at 1000 lines");

  // company details come from env, empty ones are dropped
  const co = loadCompany({ COMPANY_ADDRESS: "12 Port Rd\\nMumbai", COMPANY_BANK: "A/C 123\nIFSC X", COMPANY_GSTIN: " 27ABC ", COMPANY_PHONE: "+91 22 1", COMPANY_FAX: "+91 22 2", COMPANY_SIGNATORY: "A Person", COMPANY_PROFORMA_PREFIX: "P I/" });
  check(co.name === "Afro Asiatic Exporters" && co.address.length === 2 && co.bank.length === 2 && co.gstin === "27ABC", "company read from env");
  check(co.phone === "+91 22 1" && co.fax === "+91 22 2" && co.signatory === "A Person", "phone, fax and signatory read from env");
  check(co.numberPrefix === "PI" && loadCompany({}).numberPrefix === "PI", "number prefix cleaned, defaults to PI");
  check(loadCompany({}).address.length === 0 && loadCompany({}).bank.length === 0, "missing env → empty, not crash");

  // the PDF itself
  const company = loadCompany({ COMPANY_ADDRESS: "12 Port Rd, Mumbai", COMPANY_IEC: "0123456789", COMPANY_BANK: "Test Bank\nA/C 000" });
  const pdf = await buildProformaPdf({ number: "PI/2026-27/102", orderId: "AA-2026-021", data: { ...priced, notes: "Price includes ocean freight. ₹ symbol and “quotes” must not crash." }, company, approved: false });
  check(pdf.length > 1500 && Buffer.from(pdf.slice(0, 5)).toString() === "%PDF-", "draft PDF is a real PDF");
  const approved = await buildProformaPdf({ number: "PI/2026-27/102", orderId: "AA-2026-021", data: priced, company, approved: true });
  check(Buffer.from(approved.slice(0, 5)).toString() === "%PDF-" && approved.length > 1500, "approved PDF is a real PDF");
  const many = await buildProformaPdf({ number: "PI-X", orderId: "AA-X", data: { ...priced, lines: Array.from({ length: 450 }, (_, i) => i % 40 === 0 ? { heading: true, code: "", description: `SECTION ${i}`, hsn: "", quantity: 0, unit: "", unitPrice: 0 } : { ...d.lines[0], code: `CODE${i}`, description: `Item ${i} ` + "long description ".repeat(3) }) }, company, approved: true });
  check(Buffer.from(many.slice(0, 5)).toString() === "%PDF-", "450-line invoice with headings spills onto many pages without crashing");
  check(many.length > 20000, "the big invoice really contains the items");
  const unbreakable = await buildProformaPdf({ number: "PI-Z", orderId: "AA-Z", data: { ...priced, buyerName: "B".repeat(300), buyerAddress: "W".repeat(400), lines: [{ ...d.lines[0], code: "X".repeat(120), description: "Y".repeat(500) }] }, company, approved: true });
  check(Buffer.from(unbreakable.slice(0, 5)).toString() === "%PDF-", "unbreakable long words do not crash the PDF");
  const bare = await buildProformaPdf({ number: "PI-Y", orderId: "AA-Y", data: priced, company: loadCompany({}), approved: true });
  check(bare.length > 1000, "PDF works with no company details set");

  console.log(`proforma tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
