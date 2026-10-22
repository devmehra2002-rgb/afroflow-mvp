import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone, voiceCallsEnabled } from "@/lib/voice/config";
import { voiceDeps } from "@/lib/voice/deps";
import { attemptView, refreshAttempt, startCall } from "@/lib/voice/service";

export const maxDuration = 60;

const off = () => NextResponse.json({ error: "Voice calls are not switched on here." }, { status: 404 });

// GET /api/inquiries/:id/call — this inquiry's calls. Any call still in progress
// is checked with Bolna first, so the screen just keeps asking until it finishes.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!voiceCallsEnabled()) return off();
  const { id } = await params;
  const deps = voiceDeps();
  const rows = await prisma.callAttempt.findMany({ where: { inquiryId: id }, orderBy: { createdAt: "desc" } });
  const fresh = await Promise.all(rows.map((r) => refreshAttempt(deps, r)));
  return NextResponse.json({ attempts: fresh.map(attemptView) });
}

// POST /api/inquiries/:id/call { phone, consent } — a person starts a call to a new customer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!voiceCallsEnabled()) return off();
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const r = await startCall(voiceDeps(), id, normalizePhone(String(b?.phone ?? "")), b?.consent === true, session.user.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ attempt: attemptView(r.value) }, { status: 201 });
}
