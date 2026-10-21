import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { findOrCreateCustomer, nextOrderId, parseDay } from "@/lib/ops/orders";

// POST /api/import-local — one-time import of the orders (and their saved
// progress, documents and vessel info) that used to live only in one
// browser's localStorage.
//
// Order ids from each browser came from a per-browser counter, so two
// browsers can both hold an "AA-2026-001" that are different orders. Every
// imported order therefore gets a fresh server-assigned id; the old->new
// mapping is returned. Running it twice is safe: an order that already exists
// (same customer, product and creation time) is skipped, not duplicated.
// The built-in sample order is sent with keepId=true and keeps its id.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const orders: Array<Record<string, any>> = Array.isArray(b?.orders) ? b.orders : [];
  const progress = b?.progress ?? {};
  const documents = b?.documents ?? {};
  const vessels = b?.vessels ?? {};

  const mapping: Record<string, string> = {};
  let imported = 0, skipped = 0;

  for (const raw of orders) {
    if (!raw?.id || !raw?.customer || !raw?.product || !parseDay(raw?.ship)) { skipped++; continue; }
    const createdAt = raw.createdAt ? new Date(raw.createdAt) : new Date();

    const dupe = await prisma.opsOrder.findFirst({
      where: { customerName: { equals: String(raw.customer), mode: "insensitive" }, product: String(raw.product), createdAt },
    });
    if (dupe) { mapping[raw.id] = dupe.id; skipped++; continue; }
    if (raw.keepId) {
      const same = await prisma.opsOrder.findUnique({ where: { id: raw.id } });
      if (same) { mapping[raw.id] = same.id; skipped++; continue; }
    }

    const p = progress[raw.id];
    const doneCount = typeof p === "number" ? p : p?.doneCount ?? raw.doneCount ?? 1;
    const docSteps: number[] = typeof p === "object" && p?.docSteps ? p.docSteps : [];
    const data: Record<string, unknown> = {};
    if (documents[raw.id]) data.documents = documents[raw.id];
    if (Object.prototype.hasOwnProperty.call(vessels, raw.id)) data.vessel = vessels[raw.id];

    const customer = await findOrCreateCustomer(String(raw.customer), raw.country);
    const id = raw.keepId ? raw.id : await nextOrderId();
    await prisma.opsOrder.create({
      data: {
        id, customerId: customer.id, customerName: customer.name, country: raw.country ?? null,
        product: String(raw.product), qty: raw.qty ?? null, containerType: raw.containerType ?? null,
        containerCount: raw.containerCount ?? null, value: Number(raw.value) || 0, terms: raw.terms ?? null,
        shipDate: parseDay(raw.ship)!, inquiryDate: parseDay(raw.inquiryDate), createdAt,
        doneCount, docSteps, data: data as any,
      },
    });
    mapping[raw.id] = id;
    imported++;
  }
  return NextResponse.json({ imported, skipped, mapping });
}
