import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toClientOrder, findOrCreateCustomer, parseDay } from "@/lib/ops/orders";

// PUT /api/orders/:id — save an order's progress and per-order state
// (uploaded documents, vessel, etc.). If the order doesn't exist yet and
// `raw` is supplied (the built-in sample order), it is created.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => null);
  if (!b || typeof b.doneCount !== "number") return NextResponse.json({ error: "doneCount is required" }, { status: 400 });

  const existing = await prisma.opsOrder.findUnique({ where: { id } });
  if (!existing) {
    const raw = b.raw;
    if (!raw?.customer || !parseDay(raw?.ship)) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const customer = await findOrCreateCustomer(raw.customer, raw.country);
    const created = await prisma.opsOrder.create({
      data: {
        id, customerId: customer.id, customerName: customer.name, country: raw.country ?? null,
        product: raw.product, qty: raw.qty ?? null, containerType: raw.containerType ?? null,
        containerCount: raw.containerCount ?? null, value: Number(raw.value) || 0, terms: raw.terms ?? null,
        shipDate: parseDay(raw.ship)!, inquiryDate: parseDay(raw.inquiryDate),
        createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
        doneCount: b.doneCount, docSteps: b.docSteps ?? [], data: b.data ?? {},
      },
    });
    return NextResponse.json(toClientOrder(created));
  }

  const updated = await prisma.opsOrder.update({
    where: { id },
    data: { doneCount: b.doneCount, docSteps: b.docSteps ?? [], data: b.data ?? {}, updatedAt: new Date() },
  });
  return NextResponse.json(toClientOrder(updated));
}
