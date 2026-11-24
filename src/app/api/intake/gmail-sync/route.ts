import { NextRequest, NextResponse, after } from "next/server";
import { runSync } from "@/lib/gmail/sync";
import { secretsMatch } from "@/lib/intake/rules";

export const maxDuration = 60;

// GET/POST /api/intake/gmail-sync — the heartbeat. Called by a timer (and by the push endpoint).
// Protected by X-Intake-Secret, or by "Authorization: Bearer <INTAKE_SECRET>" (what a timer service can send).
// Add ?async=1 for timers that only wait ~30 seconds (cron-job.org): the answer comes back at once and the sync
// keeps running in the background until it finishes.
async function handle(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const provided = req.headers.get("x-intake-secret") ?? bearer;
  if (!secretsMatch(provided, process.env.INTAKE_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("async") === "1") {
    after(async () => { try { await runSync(); } catch (e) { console.error("async sync", e instanceof Error ? e.message : e); } });
    return NextResponse.json({ accepted: true });
  }
  return NextResponse.json(await runSync());
}
export const GET = handle;
export const POST = handle;
