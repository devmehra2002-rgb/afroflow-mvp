import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildAuthUrl } from "@/lib/gmail/client";

// Open this page once (while signed in) to connect the owner's Gmail.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const state = crypto.randomBytes(24).toString("hex");
  const res = NextResponse.redirect(buildAuthUrl(state, process.env.GMAIL_OWNER_EMAIL));
  res.cookies.set("gmail_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/gmail" });
  return res;
}
