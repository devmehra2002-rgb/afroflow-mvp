// Voice calls to new customers (a local trial). Everything about WHEN a call is
// allowed is plain code in this file: the AI never decides to call anyone.

export const MAX_ATTEMPTS = 3;
export const MIN_GAP_MINUTES = 10;
export const CALL_TIMEOUT_MINUTES = 20;

type Env = Record<string, string | undefined>;

// The feature only exists when the Bolna keys are set AND the app is running in
// development mode (npm run dev). On the live site NODE_ENV is "production", so
// it stays off even if the keys were ever added there, unless ALLOW_VOICE_CALLS=1.
export function voiceCallsEnabled(env: Env = process.env): boolean {
  if (!env.BOLNA_API_KEY || !env.BOLNA_AGENT_ID) return false;
  return env.NODE_ENV !== "production" || env.ALLOW_VOICE_CALLS === "1";
}

// +<country code><number>, 8 to 15 digits in total
export const isE164 = (s: string) => /^\+[1-9]\d{7,14}$/.test(s);

export function normalizePhone(raw: string): string {
  const t = (raw ?? "").trim();
  const digits = t.replace(/[^\d]/g, "");
  return t.startsWith("+") ? `+${digits}` : digits ? `+${digits}` : "";
}

export interface AttemptLike { status: string; createdAt: Date }
export interface InquiryLike { status: string }

export type CallCheck = { ok: true } | { ok: false; reason: string };

// The rules for starting a call, in order. The first that fails wins.
export function canStartCall(inq: InquiryLike, attempts: AttemptLike[], phone: string, consent: boolean, now = new Date()): CallCheck {
  if (inq.status !== "NEW_CUSTOMER") return { ok: false, reason: "Calls are only for new customers." };
  if (!consent) return { ok: false, reason: "Tick the box to confirm the buyer agreed to be called." };
  if (!isE164(phone)) return { ok: false, reason: "Enter the phone number with country code, like +919876543210." };
  if (attempts.some((a) => a.status === "CALLING")) return { ok: false, reason: "A call to this buyer is already in progress." };
  if (attempts.length >= MAX_ATTEMPTS) return { ok: false, reason: `Already tried ${MAX_ATTEMPTS} times. Reach out another way.` };
  const last = attempts.reduce<Date | null>((m, a) => (!m || a.createdAt > m ? a.createdAt : m), null);
  if (last && now.getTime() - last.getTime() < MIN_GAP_MINUTES * 60_000) {
    return { ok: false, reason: `Wait ${MIN_GAP_MINUTES} minutes between calls to the same buyer.` };
  }
  return { ok: true };
}
