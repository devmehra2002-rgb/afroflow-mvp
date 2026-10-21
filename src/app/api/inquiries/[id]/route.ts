import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const ALLOWED = ["NEW_CUSTOMER", "EXISTING_CUSTOMER", "NEEDS_REVIEW", "DISMISSED"];

// PATCH /api/inquiries/:id — a human moves an inquiry: dismiss it, or tell the
// system it is a real buyer enquiry (moves it out of "Needs review").
// Converting to an order happens through POST /api/orders, not here.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => null);
  if (!b?.status || !ALLOWED.includes(b.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const updated = await prisma.inquiry.update({ where: { id }, data: { status: b.status } });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
