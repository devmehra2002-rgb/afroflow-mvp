import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

type Status = { id: string; status: string; recipient_id?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] };
type Msg = { id: string; from: string; type: string; text?: { body?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }; button?: { text?: string } };

// POST — Meta calls this when the owner writes. Rules: the signature must be genuine; only the owner's number is answered;
// the same message id is handled once (Meta retries); the reply goes out as plain text inside the open 24-hour window.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let body: { entry?: { changes?: { value?: { messages?: Msg[]; statuses?: Status[] } }[] }[] };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const owner = ownerNumber();
  // Delivery reports for what we sent: record sent / delivered / read / failed, with Meta's reason when it failed.
  const statuses = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
  for (const st of statuses) {
    const why = st.errors?.[0] ? ` (code ${st.errors[0].code}: ${st.errors[0].title ?? ""} ${st.errors[0].error_data?.details ?? st.errors[0].message ?? ""})`.slice(0, 190) : "";
    await prisma.whatsAppMessage.updateMany({ where: { id: st.id, direction: "OUT" }, data: { kind: `status:${st.status}`, error: st.status === "failed" ? `failed${why}` : null } }).catch(() => {});
  }
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
