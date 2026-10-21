import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// PATCH /api/scan-discrepancies/:id — body: { status: "RESOLVED"|"IGNORED"|"OPEN", note?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status as "RESOLVED" | "IGNORED" | "OPEN" | undefined;
  const note = typeof body?.note === "string" ? body.note : undefined;

  if (!status || !["RESOLVED", "IGNORED", "OPEN"].includes(status)) {
    return NextResponse.json({ error: "status must be RESOLVED, IGNORED, or OPEN" }, { status: 400 });
  }

  const discrepancy = await prisma.scanDiscrepancy.update({
    where: { id },
    data: {
      status,
      note,
      resolvedBy: status === "OPEN" ? null : session.user.email,
      resolvedAt: status === "OPEN" ? null : new Date(),
    },
  });

  return NextResponse.json(discrepancy);
}
