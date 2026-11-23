import { prisma } from "@/lib/prisma";
import { TOTAL_STEPS } from "@/lib/intake/constants";
import { STEPS, flowState, type FlowOrder } from "./flow";
import { clip, istDay, money, shortDate } from "./format";
import { LEAD_LABEL } from "./labels";

export const HELP_TEXT = `I'm AfroFlow. You can type:
• *orders* – what's in progress
• *AA-2026-021* – where one order stands
• *enquiries* – new buyer enquiries today
• *pending* – things waiting for you
• To decide: *APPROVE 1234*, *DENY*, or *HOLD* (I'll send the code with each request)
Nothing happens without a clear word from you.`;

const toFlow = (o: { id: string; customerName: string; product: string; doneCount: number; shipDate: Date; inquiryDate: Date | null; createdAt: Date }): FlowOrder => o;

export async function ordersText(now = new Date()): Promise<string> {
  const rows = await prisma.opsOrder.findMany({ where: { doneCount: { lt: TOTAL_STEPS } }, orderBy: { shipDate: "asc" }, take: 10 });
  if (!rows.length) return "No orders in progress right now.";
  const lines = rows.map((o) => {
    const f = flowState(toFlow(o), now);
    const risk = f.overdueDays > 0 ? ` ⚠ ${f.overdueDays}d late` : "";
    return `• *${o.id}* ${clip(o.customerName, 22)} – ${clip(o.product, 22)}\n   Step ${o.doneCount + 1}/${STEPS.length}: ${f.active?.label}${risk} · ships ${shortDate(o.shipDate)}`;
  });
  return `*${rows.length} order${rows.length > 1 ? "s" : ""} in progress*\n${lines.join("\n")}\n\nType an order number for its task flow.`;
}

export async function statusText(orderId: string, now = new Date()): Promise<string> {
  const o = await prisma.opsOrder.findUnique({ where: { id: orderId }, include: { proforma: { select: { number: true, status: true } } } });
  if (!o) return `I can't find an order called ${orderId}. Type *orders* to see the list.`;
  const f = flowState(toFlow(o), now);
  if (f.complete) return `*${o.id}* (${o.customerName}) is complete: all ${STEPS.length} steps done.`;
  const done = STEPS.slice(0, o.doneCount).map((s) => s.label);
  const next = STEPS[f.activeIndex + 1];
  const lines = [
    `*${o.id}* · ${o.customerName} · ${clip(o.product, 30)}`,
    `Done: ${o.doneCount} of ${STEPS.length}${done.length ? ` (last: ${done[done.length - 1]})` : ""}`,
    `Now: *${f.active!.label}*${f.active!.external ? " – waiting on an outside party (customer, supplier or bank)" : ` – ${f.active!.role} team`}`,
    f.dueDate ? `Due ${shortDate(f.dueDate)}${f.overdueDays > 0 ? ` – ⚠ ${f.overdueDays} day${f.overdueDays > 1 ? "s" : ""} late` : ""}` : "",
    next ? `Next: ${next.label}` : "",
    `Ship date: ${shortDate(o.shipDate)} (${f.daysToShip >= 0 ? `in ${f.daysToShip} days` : `${-f.daysToShip} days ago`})`,
    o.proforma ? `Proforma ${o.proforma.number}: ${o.proforma.status === "APPROVED" ? "approved" : "draft, not approved"}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function enquiriesText(now = new Date()): Promise<string> {
  const since = new Date(istDay(now) + "T00:00:00+05:30");
  const rows = await prisma.inquiry.findMany({
    where: { receivedAt: { gte: since }, status: { in: ["NEW_CUSTOMER", "EXISTING_CUSTOMER"] } },
    orderBy: { receivedAt: "desc" }, take: 8,
    include: { customer: { select: { name: true } }, leadChecks: { orderBy: { createdAt: "desc" }, take: 1, select: { tier: true, score: true } } },
  });
  if (!rows.length) return "No new buyer enquiries today.";
  const lines = rows.map((r) => {
    const lead = r.leadChecks[0] ? ` · ${LEAD_LABEL[r.leadChecks[0].tier] ?? r.leadChecks[0].tier} ${r.leadChecks[0].score}/100` : "";
    return `• ${clip(r.customer?.name ?? r.fromName ?? r.fromEmail, 28)}${lead}\n   ${clip(r.subject ?? "(no subject)", 50)}`;
  });
  return `*${rows.length} enquir${rows.length > 1 ? "ies" : "y"} today*\n${lines.join("\n")}`;
}

export async function pendingText(): Promise<string> {
  const rows = await prisma.approvalRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 5 });
  if (!rows.length) return "Nothing is waiting for your approval.";
  return `*Waiting for you*\n${rows.map((r) => `• ${r.summary}\n   Reply *APPROVE ${r.code}*, *DENY ${r.code}* or *HOLD ${r.code}*`).join("\n")}`;
}
export { money };
