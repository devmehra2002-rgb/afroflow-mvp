import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exchangeCode, GMAIL_SCOPES } from "@/lib/gmail/client";
import { encryptToken } from "@/lib/gmail/crypto";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const u = new URL(req.url);
  const state = u.searchParams.get("state");
  const code = u.searchParams.get("code");
  if (!code || !state || state !== req.cookies.get("gmail_oauth_state")?.value) {
    return NextResponse.json({ error: "Connection was cancelled or the link expired. Open /api/gmail/connect again." }, { status: 400 });
  }
  const tok = await exchangeCode(code);
  if (!tok.refresh_token) return NextResponse.json({ error: "Google did not return a long-lived sign-in. Remove AfroFlow at myaccount.google.com/permissions and connect again." }, { status: 400 });

  const p = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tok.access_token}` } });
  if (!p.ok) return NextResponse.json({ error: "Could not read the Gmail profile. Make sure the Gmail permissions were ticked." }, { status: 400 });
  const profile = (await p.json()) as { emailAddress: string; historyId: string };
  const owner = process.env.GMAIL_OWNER_EMAIL?.toLowerCase();
  if (owner && profile.emailAddress.toLowerCase() !== owner) {
    return NextResponse.json({ error: `Connected the wrong Gmail account (${profile.emailAddress}).` }, { status: 400 });
  }
  void GMAIL_SCOPES;
  await prisma.gmailConnection.upsert({
    where: { id: "owner" },
    create: { id: "owner", email: profile.emailAddress, refreshTokenEnc: encryptToken(tok.refresh_token), historyId: profile.historyId },
    update: { email: profile.emailAddress, refreshTokenEnc: encryptToken(tok.refresh_token), historyId: profile.historyId, lastError: null },
  });
  const res = NextResponse.redirect(new URL("/api/gmail/status", req.url));
  res.cookies.delete({ name: "gmail_oauth_state", path: "/api/gmail" });
  return res;
}
