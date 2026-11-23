import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { digits, metaSender, ownerNumber, verifySignature } from "@/lib/whatsapp/client";
import { respond } from "@/lib/whatsapp/inbound";
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
    try { await prisma.whatsAppMessage.create({ data: { id: m.id, direction: "IN", waId: owner, kind: m.type, body: (m.text?.body ?? "").slice(0, 1000) || null } }); }
    catch (e) { if ((e as { code?: string }).code === "P2002") continue; throw e; } // already handled
    try {
      const text = m.text?.body ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.button?.text ?? "";
      const { reply, intent } = m.type === "audio" || m.type === "voice" ? { reply: "I can't listen to voice notes yet. Please type your message.", intent: "VOICE" } : text ? await respond(text, owner) : { reply: "I can only read text messages for now.", intent: "UNSUPPORTED" };
      const sent = await metaSender.sendText(owner, reply);
      await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { intent } });
      await prisma.whatsAppMessage.create({ data: { id: sent.id, direction: "OUT", waId: owner, body: reply.slice(0, 1500), intent } }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed";
      await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { error: msg.slice(0, 200) } }).catch(() => {});
      await metaSender.sendText(owner, "Sorry, something went wrong on my side. Please try again in a minute.").catch(() => {});
    }
  }
  // the owner just wrote, so the 24-hour window is open: deliver anything that was waiting
  if (msgs.length) await flush().catch(() => {});
  return NextResponse.json({ ok: true });
}
