import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revisedNumber } from "@/lib/proforma/calc";
import { proformaView } from "@/lib/proforma/view";

// POST /api/orders/:id/proforma/reopen — unlock an approved proforma as a new
// revision (number gets an -R1, -R2 suffix) so it can be edited and approved again.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const p = await prisma.orderProforma.findUnique({ where: { orderId: id } });
  if (!p) return NextResponse.json({ error: "No proforma yet." }, { status: 404 });
  if (p.status !== "APPROVED") return NextResponse.json(proformaView(p, true));
  const version = p.version + 1;
  const [updated] = await prisma.$transaction([
    prisma.orderProforma.update({ where: { orderId: id }, data: { status: "DRAFT", version, number: revisedNumber(p.number, version), approvedBy: null, approvedAt: null, updatedAt: new Date() } }),
    prisma.orderActivity.create({ data: { orderId: id, kind: "PROFORMA_REOPENED", text: `Proforma invoice ${p.number} reopened by ${session.user.email} for a revision` } }),
  ]);
  return NextResponse.json(proformaView(updated, true));
}
