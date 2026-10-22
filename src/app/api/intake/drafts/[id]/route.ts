import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { secretsMatch } from "@/lib/intake/rules";

// POST /api/intake/drafts/:id — n8n reports the Gmail draft was created ({ gmailDraftId }).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!secretsMatch(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const gmailDraftId = typeof b?.gmailDraftId === "string" && b.gmailDraftId ? b.gmailDraftId : "unknown";
  const r = await prisma.inquiry.updateMany({ where: { id, draftStatus: "QUEUED" }, data: { draftStatus: "IN_GMAIL", gmailDraftId } });
  return NextResponse.json({ updated: r.count });
}
