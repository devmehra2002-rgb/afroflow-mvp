import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { secretsMatch } from "@/lib/intake/rules";

// POST /api/intake/reminders/:id — n8n reports the nudge was sent, so it is sent only once.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!secretsMatch(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const r = await prisma.inquiry.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
  return NextResponse.json({ updated: r.count });
}
