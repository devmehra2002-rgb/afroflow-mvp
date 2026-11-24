import { prisma } from "@/lib/prisma";
import { inQuietHours } from "./format";
import { isConfigured, metaSender, ownerNumber, type Sender } from "./client";

const WINDOW_MS = 24 * 3600_000;
const EXPIRE_MS: Record<string, number> = { DAILY_SUMMARY: 12 * 3600_000 };
const DEFAULT_EXPIRE_MS = 24 * 3600_000;

// Put something in the owner's queue. Safe to call twice with the same dedupeKey: the second call does nothing.
export async function enqueue(n: { kind: string; dedupeKey: string; text: string }): Promise<boolean> {
  if (!isConfigured()) return false; // no owner number / token yet: queue nothing, so old alerts never arrive in a rush later
  try { await prisma.notification.create({ data: n }); return true; }
  catch (e) { if ((e as { code?: string }).code === "P2002") return false; throw e; }
}

export async function windowOpen(now = new Date()): Promise<boolean> {
  const last = await prisma.whatsAppMessage.findFirst({ where: { direction: "IN", waId: ownerNumber() }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return !!last && now.getTime() - last.createdAt.getTime() < WINDOW_MS;
}

const oneLine = (s: string) => s.replace(/\*/g, "").replace(/[\r\n\t]+/g, " | ").replace(/ {2,}/g, " ").trim();

// Sends what is waiting. Rules: owner only; not during quiet hours; free text only inside the owner's 24-hour window,
// otherwise an approved template if one is set (WHATSAPP_TEMPLATE_NAME), otherwise it waits; old items expire; 3+ small
// updates are combined into one message; approvals always go as their own message.
export async function flush(opts: { sender?: Sender; now?: Date } = {}): Promise<{ sent: number; waiting: number; expired: number; note?: string }> {
  const sender = opts.sender ?? metaSender, now = opts.now ?? new Date();
  if (!isConfigured()) return { sent: 0, waiting: 0, expired: 0, note: "WhatsApp is not configured" };
  const to = ownerNumber();

  const all = await prisma.notification.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 40 });
  let expired = 0;
  const live = [];
  for (const n of all) {
    // an approval alert is pointless once that request has been decided or replaced
    const stale = n.kind === "APPROVAL" && n.dedupeKey.startsWith("approval:")
      ? (await prisma.approvalRequest.findUnique({ where: { id: n.dedupeKey.slice(9) }, select: { status: true } }))?.status !== "PENDING"
      : false;
    if (stale || now.getTime() - n.createdAt.getTime() > (EXPIRE_MS[n.kind] ?? DEFAULT_EXPIRE_MS)) { await prisma.notification.update({ where: { id: n.id }, data: { status: "EXPIRED" } }); expired++; } else live.push(n);
  }
  if (!live.length) return { sent: 0, waiting: 0, expired };
  if (inQuietHours(now)) return { sent: 0, waiting: live.length, expired, note: "Quiet hours" };

  const open = await windowOpen(now);
  const tmpl = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!open && !tmpl) return { sent: 0, waiting: live.length, expired, note: "Waiting for the owner to message first (24-hour window closed)" };

  const approvals = live.filter((n) => n.kind === "APPROVAL");
  const small = live.filter((n) => n.kind !== "APPROVAL");
  const batches: { ids: string[]; text: string }[] = approvals.map((n) => ({ ids: [n.id], text: n.text }));
  if (small.length >= 3) batches.push({ ids: small.map((n) => n.id), text: `*${small.length} updates*\n${small.map((n) => `• ${n.text.replace(/\*/g, "").split("\n")[0]}`).join("\n")}\n\nType *help* for what I can do.` });
  else for (const n of small) batches.push({ ids: [n.id], text: n.text });

  let sent = 0;
  for (const b of batches.slice(0, 6)) {
    try {
      const r = open ? await sender.sendText(to, b.text) : await sender.sendTemplate(to, tmpl!, process.env.WHATSAPP_TEMPLATE_LANG || "en", [oneLine(b.text)]);
      await prisma.whatsAppMessage.create({ data: { id: r.id, direction: "OUT", waId: to, kind: open ? "text" : "template", body: b.text.slice(0, 1500) } }).catch(() => {});
      await prisma.notification.updateMany({ where: { id: { in: b.ids } }, data: { status: "SENT", sentAt: now } });
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send failed";
      if (/131031/.test(msg)) {
        // Meta has locked the WhatsApp business account (it needs business verification). Retrying cannot help and is not the
        // alert's fault: leave everything waiting (it expires after a day) and say why, once, in the sync result.
        return { sent, waiting: live.length - sent, expired, note: "WhatsApp is locked by Meta until the business is verified (error 131031); alerts are waiting" };
      }
      await prisma.notification.updateMany({ where: { id: { in: b.ids } }, data: { attempts: { increment: 1 }, lastError: msg.slice(0, 200) } });
      await prisma.notification.updateMany({ where: { id: { in: b.ids }, attempts: { gte: 5 } }, data: { status: "FAILED" } });
      return { sent, waiting: live.length - sent, expired, note: msg };
    }
  }
  return { sent, waiting: Math.max(0, live.length - batches.slice(0, 6).reduce((a, b) => a + b.ids.length, 0)), expired };
}
