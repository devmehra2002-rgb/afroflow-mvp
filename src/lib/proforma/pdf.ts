import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { amountInWords, isItem, lineAmount, totals, type ProformaData } from "./calc";
import type { Company } from "./company";

// The built-in PDF fonts only know basic Latin characters, so anything else
// (for example a rupee sign) is swapped for "?" instead of crashing.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").replace(/[\r\n\t]+/g, " ");
const fmt = (n: number, dp = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const niceDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of safe(para).split(" ")) {
      let w = word;
      // a single very long word (part numbers, URLs) is cut so it never runs off the page
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, k)); w = w.slice(k);
      }
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= width) line = t;
      else { if (line) out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

export interface PdfInput {
  number: string;
  orderId: string;
  data: ProformaData;
  company: Company;
  approved: boolean;
}

export async function buildProformaPdf(inp: PdfInput): Promise<Uint8Array> {
  const { data: d, company: c } = inp;
  const doc = await PDFDocument.create();
  doc.setTitle(`Proforma Invoice ${inp.number}`);
  doc.setAuthor(c.name);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40, BOTTOM = M + 34;
  const ink = rgb(0.1, 0.12, 0.14), muted = rgb(0.4, 0.43, 0.46), rule = rgb(0.8, 0.82, 0.84), band = rgb(0.93, 0.95, 0.96);

  const basis = [d.incoterm, d.currency].filter(Boolean).join(" ");
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const text = (t: string, x: number, size = 9.5, f = reg, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, x: number, f = reg, size = 9.5) => page.drawText(safe(t), { x: x - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color: ink });
  const hline = (yy: number, thick = 0.5, color = rule) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: thick, color });

  // table geometry
  const X = { sr: M + 4, code: M + 26, desc: M + 108, qty: M + 366, price: M + 440, total: W - M - 4 };
  const descW = X.qty - 38 - X.desc, codeW = X.desc - X.code - 6;

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 26, color: band });
    text("Sr.", X.sr, 8.5, bold); text("Item code", X.code, 8.5, bold); text("Description", X.desc, 8.5, bold);
    right("Qty", X.qty, bold, 8.5); right("Unit price", X.price, bold, 8.5); right("Total", X.total, bold, 8.5);
    y -= 10;
    if (basis) { right(basis, X.price, reg, 7.5); right(d.currency, X.total, reg, 7.5); }
    y -= 20;
  };

  const newPage = (continued: boolean) => {
    page = doc.addPage([W, H]); pages.push(page); y = H - M;
    if (!inp.approved) page.drawText("DRAFT", { x: 120, y: 330, size: 130, font: bold, color: rgb(0.9, 0.9, 0.9), rotate: degrees(40), opacity: 0.6 });
    if (continued) {
      text(`Proforma Invoice ${inp.number} (continued)`, M, 9, bold, muted); y -= 10; hline(y); y -= 22;
      tableHeader();
    }
  };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(true); };

  newPage(false);

  // ---- company header ----
  text(c.name, M, 16, bold); y -= 15;
  for (const a of c.address) { text(a, M, 9, reg, muted); y -= 11.5; }
  const contact = [c.phone && `Tel: ${c.phone}`, c.fax && `Fax: ${c.fax}`, c.email && `Email: ${c.email}`].filter(Boolean).join("   |   ");
  if (contact) { text(contact, M, 9, reg, muted); y -= 11.5; }
  const ids = [c.gstin && `GSTIN: ${c.gstin}`, c.iec && `IEC: ${c.iec}`].filter(Boolean).join("   |   ");
  if (ids) { text(ids, M, 9, reg, muted); y -= 11.5; }
  y -= 8; hline(y, 1); y -= 24;

  // ---- title and invoice details ----
  text("PROFORMA INVOICE", M, 15, bold);
  const rx = W - M - 205, top = y;
  const meta: [string, string][] = [["Pr. Inv. No.", inp.number], ["Date", niceDate(d.issueDate)]];
  if (d.buyerRef) meta.push(["Your Ref.", d.buyerRef]);
  meta.push(["Valid until", niceDate(d.validUntil)], ["Order ref.", inp.orderId]);
  for (const [k, v] of meta) { text(k, rx, 9, reg, muted); text(wrap(v, bold, 9.5, 130)[0] ?? "", rx + 70, 9.5, bold); y -= 13; }
  y = Math.min(y, top - 14) - 12;

  // ---- buyer and terms ----
  text("BILL TO", M, 8.5, bold, muted); text("TERMS", M + 280, 8.5, bold, muted); y -= 13;
  const buyer: [string, boolean][] = [[d.buyerName, true]];
  for (const l of wrap(d.buyerAddress || "", reg, 9.5, 240)) if (l) buyer.push([l, false]);
  if (d.buyerPhone) buyer.push([`Phone: ${d.buyerPhone}`, false]);
  if (d.buyerEmail) buyer.push([`Email: ${d.buyerEmail}`, false]);
  const terms: [string, string][] = [["Price basis", basis], ["Country of origin", d.countryOfOrigin], ["Port of loading", d.portOfLoading], ["Port of discharge", d.portOfDischarge],
    ["Payment", d.paymentTerms], ["Shipment", d.shipmentMode], ["Delivery", d.deliveryTime], ["Packing", d.packing]];
  const startY = y;
  buyer.forEach(([t, b], i) => { y = startY - i * 12.5; if (t) text(t, M, 9.5, b ? bold : reg); });
  let ty = startY;
  for (const [k, v] of terms) {
    if (!v) continue;
    const ls = wrap(v, reg, 9.5, W - M - (M + 372));
    y = ty; text(k, M + 280, 9, reg, muted);
    ls.forEach((l, i) => { y = ty - i * 12; if (l) text(l, M + 372, 9.5); });
    ty -= ls.length * 12 + 0.5;
  }
  y = Math.min(startY - buyer.length * 12.5, ty) - 14;
  need(60);
  tableHeader();

  // ---- items ----
  let sr = 0;
  for (const l of d.lines) {
    if (!isItem(l)) {
      const hs = wrap(l.description, bold, 9.5, W - 2 * M - 30);
      need(hs.length * 12 + 12);
      page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: hs.length * 12 + 2, color: rgb(0.97, 0.97, 0.98) });
      hs.forEach((t, k) => page.drawText(t, { x: X.code, y: y - k * 12, size: 9.5, font: bold, color: ink }));
      y -= hs.length * 12 + 6;
      continue;
    }
    sr++;
    const desc = wrap(l.description, reg, 9, descW), code = wrap(l.code, reg, 9, codeW);
    const rows = Math.max(desc.length, code.length, 1);
    need(rows * 11 + 8);
    text(String(sr), X.sr, 9);
    code.forEach((t, k) => page.drawText(t, { x: X.code, y: y - k * 11, size: 9, font: reg, color: ink }));
    desc.forEach((t, k) => page.drawText(t, { x: X.desc, y: y - k * 11, size: 9, font: reg, color: ink }));
    right(l.quantity.toLocaleString("en-US"), X.qty, reg, 9);
    right(fmt(l.unitPrice, l.unitPrice % 0.01 === 0 || Math.abs(l.unitPrice * 100 - Math.round(l.unitPrice * 100)) < 1e-9 ? 2 : 4), X.price, reg, 9);
    right(fmt(lineAmount(l)), X.total, reg, 9);
    y -= rows * 11 + 4;
    hline(y + 2);
    y -= 3;
  }

  // ---- totals ----
  const t = totals(d);
  need(70); y -= 6;
  text(`TOTAL ${basis}`.trim(), X.price - 120, 10.5, bold); right(fmt(t.total), X.total, bold, 10.5); y -= 15;
  if (d.currency !== "INR" && t.inr !== null) {
    text(`Approx. INR @ ${d.exchangeRateToInr}`, X.price - 120, 9, reg, muted); right(fmt(t.inr), X.total, reg, 9); y -= 14;
  }
  const words = wrap(amountInWords(t.total, d.currency).toUpperCase(), bold, 9, W - 2 * M);
  need(words.length * 12 + 10);
  y -= 4; words.forEach((w) => { text(w, M, 9, bold); y -= 12; });
  y -= 8;

  const block = (title: string, ls: string[], f: PDFFont = reg) => {
    if (!ls.length) return;
    need(ls.length * 12 + 26);
    text(title, M, 8.5, bold, muted); y -= 13;
    for (const s of ls) { text(s, M, 9.5, f); y -= 12; }
    y -= 8;
  };
  block("BENEFICIARY BANK DETAILS", c.bank.length ? [...c.bank, `Account name: ${c.name}`] : []);
  block("NOTES", d.notes ? wrap(d.notes, reg, 9.5, W - 2 * M) : []);
  block("TERMS", d.termsText ? wrap(d.termsText, reg, 8.5, W - 2 * M) : []);

  // ---- signature ----
  need(70); y -= 8;
  const sx = W - M - 200;
  text(`For ${c.name}`.toUpperCase(), sx, 9.5, bold); y -= 38;
  page.drawLine({ start: { x: sx, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 0.5, color: rule });
  if (c.signatory) { text(c.signatory, sx, 9.5, bold); y -= 12; }
  text("Authorised signatory", sx, 8.5, reg, muted);

  // ---- footer on every page ----
  const foot = inp.approved
    ? `Proforma invoice ${inp.number}, valid until ${niceDate(d.validUntil)}. Not a demand for payment.`
    : "DRAFT for internal review. Not approved. Do not send to the buyer.";
  pages.forEach((p, i) => {
    p.drawText(safe(foot), { x: M, y: M - 6, size: 8, font: reg, color: muted });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: W - M - reg.widthOfTextAtSize(pg, 8), y: M - 6, size: 8, font: reg, color: muted });
  });
  return doc.save();
}
