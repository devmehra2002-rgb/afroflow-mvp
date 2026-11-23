import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveProformaFor } from "@/lib/proforma/approve";
import { proformaView } from "@/lib/proforma/view";

// POST /api/orders/:id/proforma/approve — a person approves the saved draft.
// Approving locks it and writes a line in the order's activity log. It does NOT
// send anything to the buyer.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const r = await approveProformaFor(id, session.user.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(proformaView(r.updated, true));
}
