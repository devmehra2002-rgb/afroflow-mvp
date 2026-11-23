import { prisma } from "@/lib/prisma";
import { approvalProblems, sanitizeProforma, totals } from "./calc";

// The one place a proforma gets approved (locked). Used by the website button and by the WhatsApp assistant.
export async function approveProformaFor(orderId: string, approvedBy: string): Promise<{ ok: true; updated: Awaited<ReturnType<typeof prisma.orderProforma.update>> } | { ok: false; status: number; error: string }> {
  const p = await prisma.orderProforma.findUnique({ where: { orderId } });
  if (!p) return { ok: false, status: 404, error: "Save the draft first." };
  if (p.status === "APPROVED") return { ok: true, updated: p };
  const { data, errors } = sanitizeProforma(p.data);
  if (!data) return { ok: false, status: 400, error: errors.join(" ") };
  const problems = approvalProblems(data);
  if (problems.length) return { ok: false, status: 400, error: problems.join(" ") };
  const t = totals(data);
  const [updated] = await prisma.$transaction([
    prisma.orderProforma.update({ where: { orderId }, data: { status: "APPROVED", approvedBy, approvedAt: new Date() } }),
    prisma.orderActivity.create({ data: { orderId, kind: "PROFORMA_APPROVED", text: `Proforma invoice ${p.number} approved by ${approvedBy}: ${data.currency} ${t.total.toFixed(2)}` } }),
  ]);
  return { ok: true, updated };
}
