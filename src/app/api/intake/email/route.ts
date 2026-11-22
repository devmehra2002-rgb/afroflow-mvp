import { NextRequest, NextResponse } from "next/server";
import { ingestEmail } from "@/lib/intake/ingest";
import { coerceIncoming, secretsMatch } from "@/lib/intake/rules";

export const maxDuration = 60;

// POST /api/intake/email
// Manual / test entry for one email (the Gmail sync normally does this by itself).
// Protected by the X-Intake-Secret header (not by Google sign-in).
// Body: { messageId?, from, subject, body, date? }
export async function POST(req: NextRequest) {
  if (!secretsMatch(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = await req.json().catch(() => null);
  const b = raw ? coerceIncoming(raw as Record<string, unknown>) : null;
  if (!b || !b.from || (!b.subject && !b.body)) {
    return NextResponse.json({ error: "from and a subject or body are required" }, { status: 400 });
  }
  const r = await ingestEmail(b);
  if (r.duplicate) return NextResponse.json({ id: r.id, status: r.status, duplicate: true });
  return NextResponse.json({ id: r.id, status: r.status, routeReason: r.routeReason, orderId: r.orderId });
}
