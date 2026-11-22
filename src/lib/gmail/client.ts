import { prisma } from "@/lib/prisma";
import { decryptToken } from "./crypto";

// Talks to Google directly (plain fetch, no extra packages).
// Permissions asked for: read mail, and create drafts / send the reminder to yourself. Nothing else.
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailAuthError extends Error {}

export function oauthConfig() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET are not set");
  const base = (process.env.AUTH_URL || "").replace(/\/$/, "");
  return { clientId, clientSecret, redirectUri: `${base}/api/gmail/callback` };
}

export function buildAuthUrl(state: string, loginHint?: string) {
  const { clientId, redirectUri } = oauthConfig();
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string): Promise<{ refresh_token?: string; access_token: string }> {
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!r.ok) throw new Error(`Google token exchange failed (${r.status})`);
  return r.json();
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const conn = await prisma.gmailConnection.findUnique({ where: { id: "owner" } });
  if (!conn) throw new GmailAuthError("Gmail is not connected");
  const { clientId, clientSecret } = oauthConfig();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decryptToken(conn.refreshTokenEnc), grant_type: "refresh_token" }),
  });
  if (!r.ok) {
    const msg = r.status === 400 || r.status === 401 ? "Google refused the saved sign-in: reconnect Gmail" : `Google token refresh failed (${r.status})`;
    throw new GmailAuthError(msg);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export async function gmail<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; data: T }> {
  const r = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${await accessToken()}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as T;
  if (!r.ok && r.status !== 404) throw new Error(`Gmail ${path.split("?")[0]} failed (${r.status})`);
  return { status: r.status, data };
}

// Plain-text email as the base64url string Gmail wants.
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
export function rawMail(to: string, subject: string, body: string): string {
  const mime = [`To: ${to}`, `Subject: ${header(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

export async function createDraft(to: string, subject: string, body: string): Promise<string> {
  const { data } = await gmail<{ id: string }>("/drafts", { method: "POST", body: { message: { raw: rawMail(to, subject, body) } } });
  return data.id;
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  await gmail("/messages/send", { method: "POST", body: { raw: rawMail(to, subject, body) } });
}
