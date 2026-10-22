import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { voiceCallsEnabled } from "@/lib/voice/config";

// GET /api/voice/status — does this copy of AfroFlow have voice calls switched on?
// (Only on a computer with the Bolna keys set, running in development mode.)
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ enabled: voiceCallsEnabled() });
}
