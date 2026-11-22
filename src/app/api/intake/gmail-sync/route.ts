import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/gmail/sync";
import { secretsMatch } from "@/lib/intake/rules";

export const maxDuration = 60;

// GET/POST /api/intake/gmail-sync — the heartbeat. Called by a timer (and by the push endpoint).
// Protected by X-Intake-Secret, or by "Authorization: Bearer <INTAKE_SECRET>" (what a timer service can send).
async function handle(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const provided = req.headers.get("x-intake-secret") ?? bearer;
  if (!secretsMatch(provided, process.env.INTAKE_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runSync());
}
export const GET = handle;
export const POST = handle;
