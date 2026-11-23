import { NextRequest, NextResponse } from "next/server";
import { digits, metaSender, ownerNumber, verifySignature } from "@/lib/whatsapp/client";
import { processOwnerMessage } from "@/lib/whatsapp/process";
import { flush } from "@/lib/whatsapp/notify";

export const maxDuration = 30;

// GET — Meta checks the address once when you save the webhook: it sends hub.verify_token and expects hub.challenge back.
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

type Msg = { id: string; from: string; type: string; text?: { body?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }; button?: { text?: string } };

// POST — Meta calls this when the owner writes. Rules: the signature must be genuine; only the owner's number is answered;
// the same message id is handled once (Meta retries); the reply goes out as plain text inside the open 24-hour window.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let body: { entry?: { changes?: { value?: { messages?: Msg[] } }[] }[] };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const owner = ownerNumber();
  const msgs = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.messages ?? []));
  for (const m of msgs) {
    if (!owner || digits(m.from) !== owner) continue; // anyone else is ignored
    const text = m.text?.body ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.button?.text ?? "";
    await processOwnerMessage({ id: m.id, type: m.type, text }, metaSender);
  }
  // the owner just wrote, so the 24-hour window is open: deliver anything that was waiting
  if (msgs.length) await flush({ sender: metaSender }).catch(() => {});
  return NextResponse.json({ ok: true });
}
