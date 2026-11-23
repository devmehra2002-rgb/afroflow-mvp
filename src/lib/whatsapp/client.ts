import crypto from "crypto";

// Talks to Meta's WhatsApp Cloud API with plain fetch. Settings come from environment variables:
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN,
//   OWNER_WHATSAPP (the owner's number, digits only with country code), WHATSAPP_API_VERSION (default below).
const API_VERSION = () => process.env.WHATSAPP_API_VERSION || "v23.0";

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
export const ownerNumber = () => digits(process.env.OWNER_WHATSAPP);
export const isConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && ownerNumber());

// Meta signs every webhook call: header "X-Hub-Signature-256: sha256=<hmac of the raw body using the app secret>".
export function verifySignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export type Sender = {
  sendText: (to: string, body: string) => Promise<{ id: string }>;
  sendTemplate: (to: string, name: string, lang: string, params: string[]) => Promise<{ id: string }>;
};

async function post(payload: unknown): Promise<{ id: string }> {
  const r = await fetch(`https://graph.facebook.com/${API_VERSION()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!r.ok) throw new Error(`WhatsApp send failed (${r.status}${j.error?.code ? `, code ${j.error.code}` : ""}): ${(j.error?.message ?? "").slice(0, 160)}`);
  return { id: j.messages?.[0]?.id ?? crypto.randomUUID() };
}

export const metaSender: Sender = {
  sendText: (to, body) => post({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4000), preview_url: false } }),
  sendTemplate: (to, name, lang, params) =>
    post({ messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: lang }, components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.slice(0, 900) })) }] : [] } }),
};
