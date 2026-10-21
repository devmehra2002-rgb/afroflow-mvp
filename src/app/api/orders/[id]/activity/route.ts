import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// GET /api/orders/:id/activity — the order's activity log (emails added to it,
// when it was created from an inquiry, ...), newest first.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const rows = await prisma.orderActivity.findMany({ where: { orderId: id }, orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json(rows);
}
