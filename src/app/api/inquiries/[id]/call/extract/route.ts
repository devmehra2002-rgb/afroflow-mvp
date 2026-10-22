import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { voiceCallsEnabled } from "@/lib/voice/config";
import { voiceDeps } from "@/lib/voice/deps";
import { attemptView, rereadAttempt } from "@/lib/voice/service";

export const maxDuration = 60;

// POST /api/inquiries/:id/call/extract { attemptId } — have the AI read a finished call's transcript again.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!voiceCallsEnabled()) return NextResponse.json({ error: "Voice calls are not switched on here." }, { status: 404 });
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const r = await rereadAttempt(voiceDeps(), String(b?.attemptId ?? ""), id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ attempt: attemptView(r.value) });
}
