import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toClientOrder, findOrCreateCustomer, nextOrderId, parseDay } from "@/lib/ops/orders";

// GET /api/orders — every order, newest first. Shared by the whole team.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rows = await prisma.opsOrder.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows.map(toClientOrder));
}

// POST /api/orders — create an order. The server assigns the id, so two
// people creating orders at once can never collide.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const b = await req.json().catch(() => null);
  if (!b?.customer || !b?.product || !parseDay(b?.ship)) {
    return NextResponse.json({ error: "customer, product and a valid ship date are required" }, { status: 400 });
  }
  const customer = await findOrCreateCustomer(String(b.customer), b.country);
  const id = await nextOrderId();
  const row = await prisma.opsOrder.create({
    data: {
      id,
      customerId: customer.id,
      customerName: customer.name,
      country: b.country ?? customer.country ?? null,
      product: String(b.product),
      qty: b.qty ?? null,
      containerType: b.containerType ?? null,
      containerCount: b.containerCount ?? null,
      value: Number(b.value) || 0,
      terms: b.terms ?? null,
      shipDate: parseDay(b.ship)!,
      inquiryDate: parseDay(b.inquiryDate),
      createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
      doneCount: 1,
      docSteps: [],
      data: {},
      sourceInquiryId: b.sourceInquiryId ?? null,
    },
  });
  // Created from an inquiry: link the two and note it in the order's log.
  if (b.sourceInquiryId) {
    const inq = await prisma.inquiry.findUnique({ where: { id: String(b.sourceInquiryId) } });
    if (inq) {
      await prisma.inquiry.update({ where: { id: inq.id }, data: { status: "CONVERTED", orderId: row.id, customerId: customer.id } });
      await prisma.orderActivity.create({
        data: { orderId: row.id, kind: "CREATED_FROM_EMAIL", text: `Order created from email "${inq.subject ?? "(no subject)"}" (${inq.fromEmail})`, inquiryId: inq.id },
      });
    }
  }
  return NextResponse.json(toClientOrder(row), { status: 201 });
}
