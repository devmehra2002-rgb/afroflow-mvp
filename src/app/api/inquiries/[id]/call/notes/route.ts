import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { voiceCallsEnabled } from "@/lib/voice/config";
import { cleanApplied } from "@/lib/voice/extract";

// PUT /api/inquiries/:id/call/notes { attemptId, details } — a person reviews what the AI
// heard, edits it, and saves it. Only saved (human-checked) details pre-fill the proforma.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!voiceCallsEnabled()) return NextResponse.json({ error: "Voice calls are not switched on here." }, { status: 404 });
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const attempt = await prisma.callAttempt.findFirst({ where: { id: String(b?.attemptId ?? ""), inquiryId: id } });
  if (!attempt) return NextResponse.json({ error: "Call not found." }, { status: 404 });
  if (attempt.status !== "DONE") return NextResponse.json({ error: "Only a finished call can be saved." }, { status: 400 });
  const applied = cleanApplied(b?.details);
  if (!Object.keys(applied).length) return NextResponse.json({ error: "There is nothing to save yet." }, { status: 400 });
  const u = await prisma.callAttempt.update({ where: { id: attempt.id }, data: { applied: applied as object, appliedBy: session.user.email, appliedAt: new Date() } });
  return NextResponse.json({ applied: u.applied, appliedBy: u.appliedBy, appliedAt: u.appliedAt });
}
