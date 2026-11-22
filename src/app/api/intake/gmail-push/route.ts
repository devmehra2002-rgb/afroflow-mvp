import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/gmail/sync";
import { secretsMatch } from "@/lib/intake/rules";

export const maxDuration = 60;

// POST /api/intake/gmail-push?token=… — Google Pub/Sub calls this the moment mail arrives.
// The message itself holds no email text; we just run the normal sync. Always answers 200 for a valid
// token so Pub/Sub does not retry forever (the next timer run catches anything that failed).
export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!secretsMatch(token, process.env.GMAIL_PUSH_TOKEN)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await runSync();
  return NextResponse.json({ ok: !r.error });
}
