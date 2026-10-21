import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// GET /api/customers — customers with their known email addresses.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rows = await prisma.opsCustomer.findMany({
    orderBy: { name: "asc" },
    include: { emails: true, _count: { select: { orders: true, inquiries: true } } },
  });
  return NextResponse.json(
    rows.map((c) => ({
      id: c.id, name: c.name, country: c.country,
      emails: c.emails.map((e) => e.email),
      orderCount: c._count.orders, inquiryCount: c._count.inquiries,
    }))
  );
}
