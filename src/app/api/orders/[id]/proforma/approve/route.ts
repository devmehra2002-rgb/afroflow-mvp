import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approvalProblems, sanitizeProforma, totals } from "@/lib/proforma/calc";
import { proformaView } from "@/lib/proforma/view";

// POST /api/orders/:id/proforma/approve — a person approves the saved draft.
// Approving locks it and writes a line in the order's activity log. It does NOT
// send anything to the buyer.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const p = await prisma.orderProforma.findUnique({ where: { orderId: id } });
  if (!p) return NextResponse.json({ error: "Save the draft first." }, { status: 404 });
  if (p.status === "APPROVED") return NextResponse.json(proformaView(p, true));
  const { data, errors } = sanitizeProforma(p.data);
  if (!data) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  const problems = approvalProblems(data);
  if (problems.length) return NextResponse.json({ error: problems.join(" ") }, { status: 400 });

  const t = totals(data);
  const [updated] = await prisma.$transaction([
    prisma.orderProforma.update({ where: { orderId: id }, data: { status: "APPROVED", approvedBy: session.user.email, approvedAt: new Date() } }),
    prisma.orderActivity.create({
      data: { orderId: id, kind: "PROFORMA_APPROVED", text: `Proforma invoice ${p.number} approved by ${session.user.email}: ${data.currency} ${t.total.toFixed(2)}` },
    }),
  ]);
  return NextResponse.json(proformaView(updated, true));
}
