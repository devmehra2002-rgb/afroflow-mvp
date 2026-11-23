import { prisma } from "@/lib/prisma";
import { TOTAL_STEPS } from "@/lib/intake/constants";
import { STEPS, flowState } from "./flow";
import { clip, istDay, istHour } from "./format";
import { enqueue } from "./notify";
import { LEAD_LABEL } from "./labels";

type Fields = Record<string, { value?: unknown } | null | undefined>;
const val = (f: Fields | undefined, k: string) => { const v = f?.[k]?.value; return v == null || v === "" ? null : String(v); };

export async function notifyNewEnquiry(inquiryId: string): Promise<void> {
  const q = await prisma.inquiry.findUnique({ where: { id: inquiryId }, include: { customer: { select: { name: true } } } });
  if (!q || (q.status !== "NEW_CUSTOMER" && q.status !== "EXISTING_CUSTOMER")) return;
  const f = (q.extracted as { fields?: Fields } | null)?.fields;
  const who = q.customer?.name ?? q.fromName ?? q.fromEmail;
  const what = [val(f, "product"), val(f, "quantity"), [val(f, "incoterm"), val(f, "destinationPort")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  await enqueue({ kind: "NEW_ENQUIRY", dedupeKey: `enquiry:${q.id}`, text: `*New enquiry*: ${clip(who, 36)} (${q.status === "EXISTING_CUSTOMER" ? "existing customer" : "new customer"})${what ? `\n${clip(what, 120)}` : ""}\nReply due in 24h.` });
}

export async function notifyLeadCheck(inquiryId: string, tier: string, score: number, suggestion: string): Promise<void> {
  const q = await prisma.inquiry.findUnique({ where: { id: inquiryId }, select: { fromName: true, fromEmail: true } });
  if (!q) return;
  await enqueue({ kind: "LEAD_CHECK", dedupeKey: `lead:${inquiryId}`, text: `*Lead check*: ${clip(q.fromName ?? q.fromEmail, 36)} is *${LEAD_LABEL[tier] ?? tier}* (${score}/100).\n${clip(suggestion, 140)}` });
}

export async function notifyReplyDue(inquiryId: string, subject: string | null, who: string, minutesLeft: number): Promise<void> {
  const when = minutesLeft < 0 ? "is *overdue*" : `is due in ${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m`;
  await enqueue({ kind: "REPLY_DUE", dedupeKey: `reply:${inquiryId}`, text: `Reply to ${clip(who, 30)} ${when}: "${clip(subject ?? "(no subject)", 50)}".` });
}

// Delay rules (starting points; tune with the owner): a step past its due date; shipping within 7 days with documentation not
// done; an open order with no activity for 5 days. Each fires once per situation.
export async function scanOrderDelays(now = new Date()): Promise<number> {
  const orders = await prisma.opsOrder.findMany({ where: { doneCount: { lt: TOTAL_STEPS } }, include: { activity: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } }, take: 100 });
  let n = 0;
  for (const o of orders) {
    const f = flowState(o, now);
    if (f.overdueDays >= 1 && f.active) {
      if (await enqueue({ kind: "ORDER_DELAY", dedupeKey: `delay:${o.id}:${f.activeIndex}`, text: `*${o.id}* (${clip(o.customerName, 24)}): "${f.active.label}" is ${f.overdueDays} day${f.overdueDays > 1 ? "s" : ""} late. Type ${o.id} for the flow.` })) n++;
    }
    const docIdx = STEPS.findIndex((s) => s.label === "Prepare Documentation");
    if (f.daysToShip >= 0 && f.daysToShip <= 7 && o.doneCount <= docIdx) {
      if (await enqueue({ kind: "ORDER_DELAY", dedupeKey: `shiprisk:${o.id}`, text: `*${o.id}* (${clip(o.customerName, 24)}): ship date is in ${f.daysToShip} day${f.daysToShip === 1 ? "" : "s"} and documentation is not done.` })) n++;
    }
    const last = o.activity[0]?.createdAt ?? o.updatedAt;
    if (now.getTime() - last.getTime() > 5 * 86400_000) {
      if (await enqueue({ kind: "ORDER_DELAY", dedupeKey: `idle:${o.id}:${istDay(last)}`, text: `*${o.id}* (${clip(o.customerName, 24)}): no activity for 5 days.` })) n++;
    }
  }
  return n;
}

// One short message each morning (from 9:00 Indian time), only if there is something to say.
export async function dailySummary(now = new Date()): Promise<boolean> {
  const h = istHour(now);
  if (h < 9 || h >= 12) return false;
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [enq, pend, orders] = await Promise.all([
    prisma.inquiry.count({ where: { receivedAt: { gte: since }, status: { in: ["NEW_CUSTOMER", "EXISTING_CUSTOMER"] } } }),
    prisma.approvalRequest.count({ where: { status: "PENDING" } }),
    prisma.opsOrder.findMany({ where: { doneCount: { lt: TOTAL_STEPS } }, take: 100 }),
  ]);
  const late = orders.filter((o) => flowState(o, now).overdueDays > 0).length;
  if (!enq && !pend && !late) return false;
  const parts = [`${enq} new enquir${enq === 1 ? "y" : "ies"} (24h)`, `${pend} awaiting your approval`, `${late} order${late === 1 ? "" : "s"} running late`];
  return enqueue({ kind: "DAILY_SUMMARY", dedupeKey: `summary:${istDay(now)}`, text: `*Good morning.* ${parts.join(", ")}.\nType *orders* or *pending*.` });
}
