import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { approvalProblems, sanitizeProforma, totals } from "@/lib/proforma/calc";
import { approveProformaFor } from "@/lib/proforma/approve";
import { enqueue } from "./notify";
import { clip, money } from "./format";

// Version-bound approvals. The owner approves exactly the numbers that were shown. If the proforma is edited afterwards,
// the old request is marked STALE and an "approve" for it is refused.
export function proformaHash(p: { number: string; version: number; data: unknown }): string {
  return crypto.createHash("sha256").update(`${p.number}|${p.version}|${JSON.stringify(p.data)}`).digest("hex").slice(0, 24);
}
const newCode = () => String(crypto.randomInt(1000, 10000));

// Called by the sweep: a saved, valid, unapproved proforma that nobody has touched for 10 minutes (and was saved in the last 7 days,
// so old drafts never flood the owner) becomes a request.
export async function sweepProformaApprovals(now = new Date()): Promise<number> {
  const settled = new Date(now.getTime() - 10 * 60_000);
  const drafts = await prisma.orderProforma.findMany({ where: { status: "DRAFT", updatedAt: { lte: settled, gte: new Date(now.getTime() - 7 * 86400_000) } }, include: { order: { select: { customerName: true, product: true, terms: true } } }, take: 10 });
  let made = 0;
  for (const p of drafts) {
    const { data } = sanitizeProforma(p.data);
    if (!data || approvalProblems(data).length) continue;
    const hash = proformaHash(p);
    const existing = await prisma.approvalRequest.findMany({ where: { kind: "PROFORMA", refId: p.orderId } });
    if (existing.some((a) => a.versionHash === hash)) continue; // already asked (pending, held or denied) for exactly this version
    await prisma.approvalRequest.updateMany({ where: { kind: "PROFORMA", refId: p.orderId, status: "PENDING" }, data: { status: "STALE" } });
    const t = totals(data);
    const summary = `Proforma ${p.number}: ${clip(p.order.customerName, 28)}, ${clip(p.order.product, 28)}, ${money(data.currency, t.total)}${p.order.terms ? ` ${p.order.terms}` : ""}`;
    const a = await prisma.approvalRequest.create({ data: { kind: "PROFORMA", refId: p.orderId, versionHash: hash, code: newCode(), summary } });
    await enqueue({ kind: "APPROVAL", dedupeKey: `approval:${a.id}`, text: `*Approval needed*\n${summary}\n\nReply *APPROVE ${a.code}* to approve and lock it, *DENY ${a.code}* or *HOLD ${a.code}*.\nApproving does not send anything to the buyer.` });
    made++;
  }
  return made;
}

type Decision = "APPROVE" | "DENY" | "HOLD";
const word = { APPROVE: "approved", DENY: "denied", HOLD: "put on hold" } as const;

export async function decide(decision: Decision, code: string | null, via: string, text: string): Promise<string> {
  const pending = await prisma.approvalRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (!pending.length) return "Nothing is waiting for your approval right now.";
  const target = code ? pending.find((p) => p.code === code) : pending.length === 1 ? pending[0] : undefined;
  if (!target && code) {
    const old = await prisma.approvalRequest.findFirst({ where: { code }, orderBy: { createdAt: "desc" } });
    if (old && old.status !== "PENDING") return `That request (${code}) is no longer open: it was ${old.status.toLowerCase()}. Type *pending* to see what is open.`;
    return `I don't have a request with code ${code}. Type *pending* to see what is open.`;
  }
  if (!target) return `${pending.length} things are waiting. Please include the code, for example *${decision} ${pending[0].code}*. Type *pending* to see them.`;

  // Approving needs the code typed: a bare "approve" is never enough for something that locks a document.
  if (decision === "APPROVE" && (!code || code !== target.code)) return `To approve, type the code: *APPROVE ${target.code}*`;

  const p = await prisma.orderProforma.findUnique({ where: { orderId: target.refId } });
  if (!p) { await prisma.approvalRequest.update({ where: { id: target.id }, data: { status: "STALE" } }); return "That proforma no longer exists."; }
  if (p.status === "APPROVED") { await prisma.approvalRequest.update({ where: { id: target.id }, data: { status: "APPROVED", decidedAt: new Date(), decidedVia: "already approved" } }); return `Proforma ${p.number} was already approved.`; }
  if (proformaHash(p) !== target.versionHash) {
    await prisma.approvalRequest.update({ where: { id: target.id }, data: { status: "STALE" } });
    return `⚠ That proforma was changed after I asked you. Your reply was NOT applied. I'll send the new numbers in a few minutes.`;
  }

  if (decision === "APPROVE") {
    const r = await approveProformaFor(target.refId, `WhatsApp (owner ${via})`);
    if (!r.ok) return `I could not approve it: ${r.error}`;
  } else {
    await prisma.orderActivity.create({ data: { orderId: target.refId, kind: decision === "DENY" ? "PROFORMA_DENIED" : "PROFORMA_HELD", text: `Proforma ${p.number} ${word[decision]} by the owner on WhatsApp` } });
  }
  await prisma.approvalRequest.update({ where: { id: target.id }, data: { status: decision === "APPROVE" ? "APPROVED" : decision === "DENY" ? "DENIED" : "HELD", decidedAt: new Date(), decidedVia: via, decisionText: text.slice(0, 100) } });
  return decision === "APPROVE" ? `✅ Proforma ${p.number} approved and locked. Nothing was sent to the buyer.` : `Noted: ${p.number} ${word[decision]}.`;
}
