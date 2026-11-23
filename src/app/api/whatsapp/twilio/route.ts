import { NextRequest, NextResponse } from "next/server";
import { digits, ownerNumber, twilioSender, verifyTwilioSignature } from "@/lib/whatsapp/client";
import { processOwnerMessage } from "@/lib/whatsapp/process";
import { flush } from "@/lib/whatsapp/notify";

export const maxDuration = 30;

// POST /api/whatsapp/twilio — Twilio calls this (form-encoded) when the owner writes to the WhatsApp number.
// Rules: the X-Twilio-Signature must be genuine; only the owner's number is answered; the same MessageSid is handled once.
// Set TWILIO_WEBHOOK_URL if Twilio is configured with a different public address than the default below.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params: Record<string, string> = {};
  new URLSearchParams(raw).forEach((v, k) => { params[k] = v; });
  const url = process.env.TWILIO_WEBHOOK_URL || `${(process.env.AUTH_URL || "").replace(/\/$/, "")}/api/whatsapp/twilio`;
  if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"), process.env.TWILIO_AUTH_TOKEN)) {
    console.error(`twilio webhook: bad signature for url ${url} (the address saved in Twilio must match this exactly)`);
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  const owner = ownerNumber();
  const from = digits(params.From);
  const empty = () => new NextResponse("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });
  if (!owner || from !== owner || !params.MessageSid) return empty(); // anyone else is ignored
  const isMedia = Number(params.NumMedia || 0) > 0;
  await processOwnerMessage({ id: params.MessageSid, type: isMedia ? ((params.MediaContentType0 || "").startsWith("audio") ? "audio" : "media") : "text", text: params.Body ?? "" }, twilioSender);
  await flush({ sender: twilioSender }).catch(() => {});
  return empty();
}
