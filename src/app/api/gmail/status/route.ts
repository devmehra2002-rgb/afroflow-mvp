import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Is Gmail connected, and when did it last check? (No secrets are shown.)
export async function GET() {
  if (!(await auth())) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const c = await prisma.gmailConnection.findUnique({ where: { id: "owner" }, select: { email: true, lastSyncAt: true, lastError: true, watchExpiresAt: true, createdAt: true } });
  return NextResponse.json(c ? { connected: true, ...c } : { connected: false });
}
