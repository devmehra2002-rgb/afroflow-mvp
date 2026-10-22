import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { secretsMatch } from "@/lib/intake/rules";

// GET /api/intake/drafts — n8n asks: which replies has a person approved for
// Gmail Drafts? Protected by X-Intake-Secret. Nothing here ever sends an email.
export async function GET(req: NextRequest) {
  if (!secretsMatch(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await prisma.inquiry.findMany({
    where: { draftStatus: "QUEUED", draftBody: { not: null } },
    orderBy: { receivedAt: "asc" },
    take: 20,
    select: { id: true, fromEmail: true, draftSubject: true, draftBody: true },
  });
  return NextResponse.json(rows.map((r) => ({ id: r.id, to: r.fromEmail, subject: r.draftSubject, body: r.draftBody })));
}
