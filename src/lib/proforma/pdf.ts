import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { lineAmount, totals, type ProformaData } from "./calc";
import type { Company } from "./company";

// The built-in PDF fonts only know basic Latin characters, so anything else
// (for example a rupee sign) is swapped for "?" instead of crashing.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").replace(/[\r\n]+/g, " ");
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const niceDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of safe(para).split(" ")) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= width) line = t;
      else { if (line) out.push(line); line = word; }
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
  const W = 595.28, H = 841.89, M = 40;
  const ink = rgb(0.1, 0.12, 0.14), muted = rgb(0.4, 0.43, 0.46), line = rgb(0.8, 0.82, 0.84);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const watermark = (p: PDFPage) => {
    if (!inp.approved) p.drawText("DRAFT", { x: 120, y: 330, size: 130, font: bold, color: rgb(0.9, 0.9, 0.9), rotate: degrees(40), opacity: 0.6 });
  };
  watermark(page);
  const text = (t: string, x: number, size = 9.5, f = reg, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const newPage = () => { page = doc.addPage([W, H]); watermark(page); y = H - M; };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };

  // header
  text(c.name, M, 16, bold); y -= 14;
  for (const a of c.address) { text(a, M, 9, reg, muted); y -= 11.5; }
  const ids = [c.gstin && `GSTIN: ${c.gstin}`, c.iec && `IEC: ${c.iec}`, c.email].filter(Boolean).join("   |   ");
  if (ids) { text(ids, M, 9, reg, muted); y -= 11.5; }
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line }); y -= 24;

  text("PROFORMA INVOICE", M, 15, bold);
  const rx = W - M - 190;
  const meta: [string, string][] = [["Invoice no.", inp.number], ["Date", niceDate(d.issueDate)], ["Valid until", niceDate(d.validUntil)], ["Order ref.", inp.orderId]];
  const top = y;
  for (const [k, v] of meta) { text(k, rx, 9, reg, muted); text(v, rx + 70, 9.5, bold); y -= 13; }
  y = Math.min(y, top - 14) - 10;

  // buyer + terms
  text("BILL TO", M, 8.5, bold, muted); text("TERMS", M + 280, 8.5, bold, muted); y -= 13;
  const buyer = [d.buyerName, ...wrap(d.buyerAddress || "", reg, 9.5, 240)].filter(Boolean);
  const terms: [string, string][] = [["Incoterm", d.incoterm], ["Port of loading", d.portOfLoading], ["Port of discharge", d.portOfDischarge], ["Payment", d.paymentTerms]];
  const startY = y;
  buyer.forEach((b, i) => { y = startY - i * 12.5; text(b, M, 9.5, i === 0 ? bold : reg); });
  let ty = startY;
  for (const [k, v] of terms) {
    y = ty; text(k, M + 280, 9, reg, muted);
    const ls = v ? wrap(v, reg, 9.5, W - M - (M + 370)) : [""];
    ls.forEach((l, i) => { y = ty - i * 12; if (l) text(l, M + 370, 9.5); });
    ty -= Math.max(1, ls.length) * 12 + 0.5;
  }
  y = Math.min(startY - buyer.length * 12.5, ty) - 14;

  // table
  const col = { n: M, desc: M + 22, hsn: M + 270, qty: M + 330, unit: M + 365, price: M + 410, amt: W - M };
  page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: rgb(0.93, 0.95, 0.96) });
  const right = (t: string, x: number, f = reg, size = 9) => { page.drawText(safe(t), { x: x - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color: ink }); };
  text("#", col.n + 4, 9, bold); text("Description", col.desc, 9, bold); text("HSN", col.hsn, 9, bold);
  right("Qty", col.qty + 28, bold); text("Unit", col.unit + 4, 9, bold); right("Unit price", col.price + 52, bold); right("Amount", col.amt - 4, bold);
  y -= 20;
  d.lines.forEach((l, i) => {
    const desc = wrap(l.description, reg, 9.5, 235);
    need(desc.length * 12 + 8);
    text(String(i + 1), col.n + 4);
    desc.forEach((t, k) => { const yy = y; page.drawText(t, { x: col.desc, y: yy - k * 12, size: 9.5, font: reg, color: ink }); });
    text(l.hsn, col.hsn);
    right(l.quantity.toLocaleString("en-US"), col.qty + 28); text(l.unit, col.unit + 4);
    right(l.unitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }), col.price + 52);
    right(lineAmount(l).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), col.amt - 4);
    y -= desc.length * 12 + 6;
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.5, color: line });
  });

  // totals
  const t = totals(d);
  need(70); y -= 8;
  text(`Total (${d.currency})`, col.price - 100, 10.5, bold); right(money(t.total, d.currency), col.amt - 4, bold, 10.5); y -= 15;
  if (d.currency !== "INR" && t.inr !== null) {
    text(`Approx. INR @ ${d.exchangeRateToInr}`, col.price - 100, 9, reg, muted);
    right(money(t.inr, "INR"), col.amt - 4, reg, 9); y -= 14;
  }
  y -= 10;

  const block = (title: string, ls: string[]) => {
    if (!ls.length) return;
    need(ls.length * 12 + 24);
    text(title, M, 8.5, bold, muted); y -= 13;
    for (const s of ls) { text(s, M, 9.5); y -= 12; }
    y -= 8;
  };
  block("BANK DETAILS", c.bank);
  block("NOTES", d.notes ? wrap(d.notes, reg, 9.5, W - 2 * M) : []);

  need(40);
  y = Math.min(y, M + 30);
  const foot = inp.approved
    ? `Proforma invoice, valid until ${niceDate(d.validUntil)}. Not a demand for payment.`
    : "DRAFT for internal review. Not approved. Do not send to the buyer.";
  page.drawText(safe(foot), { x: M, y: M, size: 8.5, font: reg, color: muted });
  return doc.save();
}
