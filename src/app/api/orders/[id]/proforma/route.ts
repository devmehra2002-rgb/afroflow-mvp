import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { defaultProforma, proformaNumber, sanitizeProforma } from "@/lib/proforma/calc";
import { proformaView } from "@/lib/proforma/view";

// GET /api/orders/:id/proforma — the saved proforma, or a fresh first draft built
// from the order (not saved until a person clicks Save).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const order = await prisma.opsOrder.findUnique({ where: { id }, include: { proforma: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.proforma) return NextResponse.json({ ...proformaView(order.proforma, true), orderValue: order.value });
  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json({
    saved: false, number: proformaNumber(order.id), version: 1, status: "DRAFT", approvedBy: null, approvedAt: null, orderValue: order.value,
    data: defaultProforma({ id: order.id, customerName: order.customerName, country: order.country, product: order.product, qty: order.qty, value: order.value, terms: order.terms }, today),
  });
}

// PUT /api/orders/:id/proforma — save the draft. An approved proforma is locked:
// reopen it as a revision first.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const order = await prisma.opsOrder.findUnique({ where: { id }, include: { proforma: true } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.proforma?.status === "APPROVED") return NextResponse.json({ error: "This proforma is approved and locked. Reopen it as a revision to change it." }, { status: 409 });
  const { data, errors } = sanitizeProforma(await req.json().catch(() => null));
  if (!data) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  const saved = await prisma.orderProforma.upsert({
    where: { orderId: id },
    create: { orderId: id, number: proformaNumber(id), data: data as object },
    update: { data: data as object, updatedAt: new Date() },
  });
  return NextResponse.json({ ...proformaView(saved, true), orderValue: order.value });
}
