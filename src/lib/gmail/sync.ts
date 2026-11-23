import { prisma } from "@/lib/prisma";
import { REMINDER_LEAD_HOURS } from "@/lib/intake/constants";
import { ingestEmail } from "@/lib/intake/ingest";
import { parseGmailMessage, parseSender } from "@/lib/intake/rules";
import { GmailAuthError, createDraft, gmail, sendMail } from "./client";
import { runPendingLeadChecks } from "@/lib/lead/auto";
import { notifyReplyDue } from "@/lib/whatsapp/events";
import { runWhatsAppStep } from "@/lib/whatsapp/step";

type Msg = Parameters<typeof parseGmailMessage>[0] & { labelIds?: string[] };
type HistoryResp = { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[]; labelsAdded?: { message: { id: string }; labelIds?: string[] }[] }[]; nextPageToken?: string; historyId?: string };

const WATCH_RENEW_BEFORE_MS = 2 * 24 * 3600_000;
const MAX_PER_RUN = 15; // keeps one run inside the 60s limit; the rest is picked up next run

export type SyncResult = { ingested: number; duplicates: number; skipped: number; drafts: number; reminders: number; leadChecks: number; whatsapp?: { queued: number; sent: number; waiting: number; note?: string }; watchRenewed: boolean; note?: string; error?: string };

// One pass: pull new mail, save approved replies as Gmail drafts, send due reminders, keep the push watch alive.
// Safe to run as often as you like: every step is idempotent.
export async function runSync(): Promise<SyncResult> {
  const res: SyncResult = { ingested: 0, duplicates: 0, skipped: 0, drafts: 0, reminders: 0, leadChecks: 0, watchRenewed: false };
  const startedAt = Date.now();
  const conn = await prisma.gmailConnection.findUnique({ where: { id: "owner" } });
  if (!conn) return { ...res, error: "Gmail is not connected yet" };

  try {
    await pullNewMail(conn.email, conn.historyId, res);
    await pushDrafts(res);
    await sendReminders(conn.email, res);
    await renewWatch(conn.watchExpiresAt, res);
    // Lead checks last, and only with the time that is left in this run (the host stops a run at 60 seconds).
    const lc = await runPendingLeadChecks(startedAt + 55_000);
    res.leadChecks = lc.checked;
    res.whatsapp = await runWhatsAppStep().catch((e) => ({ queued: 0, sent: 0, waiting: 0, note: e instanceof Error ? e.message.slice(0, 120) : "whatsapp step failed" }));
    if (lc.note) res.note = [res.note, lc.note].filter(Boolean).join(" ");
    await prisma.gmailConnection.update({ where: { id: "owner" }, data: { lastSyncAt: new Date(), lastError: null } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed";
    res.error = msg;
    await prisma.gmailConnection.update({ where: { id: "owner" }, data: { lastError: msg.slice(0, 300) } }).catch(() => {});
    if (!(e instanceof GmailAuthError)) console.error("gmail sync", msg);
  }
  return res;
}

// Not a buyer's email: not in the inbox, our own sent mail, drafts, spam, trash, the reminder we send
// ourselves, or Gmail's Social / Promotions / Forums tabs (LinkedIn, newsletters). Primary and Updates are kept.
export function shouldSkip(labels: string[], sender: string | undefined, ownEmail: string, subject: string): boolean {
  if (!labels.includes("INBOX")) return true;
  if (labels.some((l) => ["SENT", "DRAFT", "SPAM", "TRASH", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_FORUMS"].includes(l))) return true;
  if (sender && sender === ownEmail.toLowerCase()) return true;
  return /^AfroFlow reminder:/i.test(subject);
}

// PRIVACY: AfroFlow reads ONLY mail you have put under one Gmail label (default "AfroFlow"; set GMAIL_INTAKE_LABEL
// to change it). Everything else in the inbox is never opened, stored or sent to the AI.
// If the label does not exist, nothing is read at all.
async function intakeLabelId(): Promise<string | null> {
  const name = (process.env.GMAIL_INTAKE_LABEL || "AfroFlow").toLowerCase();
  const { data } = await gmail<{ labels?: { id: string; name: string }[] }>("/labels");
  return data.labels?.find((l) => l.name.toLowerCase() === name)?.id ?? null;
}

async function ingestById(id: string, ownEmail: string, labelId: string, res: SyncResult) {
  // Look at the labels first (no email text is read yet).
  const head = await gmail<{ labelIds?: string[] }>(`/messages/${id}?format=minimal`);
  if (head.status === 404 || !(head.data.labelIds ?? []).includes(labelId)) { res.skipped++; return; }
  const { status, data } = await gmail<Msg>(`/messages/${id}?format=full`);
  if (status === 404) { res.skipped++; return; }
  const labels = data.labelIds ?? [];
  const m = parseGmailMessage(data);
  const sender = parseSender(m.from).email?.toLowerCase();
  if (shouldSkip(labels, sender, ownEmail, m.subject)) { res.skipped++; return; }
  const r = await ingestEmail(m);
  if (r.duplicate) res.duplicates++; else res.ingested++;
}

async function pullNewMail(ownEmail: string, historyId: string | null, res: SyncResult) {
  const profile = (await gmail<{ historyId: string }>("/profile")).data;
  if (!historyId) {
    // First run: start from now. Old mail is not imported.
    await prisma.gmailConnection.update({ where: { id: "owner" }, data: { historyId: profile.historyId } });
    res.note = "Started watching from now; older mail is not imported.";
    return;
  }
  const labelId = await intakeLabelId();
  if (!labelId) {
    await prisma.gmailConnection.update({ where: { id: "owner" }, data: { historyId: profile.historyId } });
    res.note = `No Gmail label named "${process.env.GMAIL_INTAKE_LABEL || "AfroFlow"}" exists, so no mail was read. Create it and add a Gmail filter that applies it to buyer emails.`;
    return;
  }
  const ids = new Set<string>();
  let page: string | undefined;
  let expired = false;
  do {
    // messageAdded: mail that arrives already labelled by your Gmail filter. labelAdded: mail you label by hand later.
    const q = new URLSearchParams({ startHistoryId: historyId, maxResults: "100" });
    q.append("historyTypes", "messageAdded");
    q.append("historyTypes", "labelAdded");
    if (page) q.set("pageToken", page);
    const { status, data } = await gmail<HistoryResp>(`/history?${q}`);
    if (status === 404) { expired = true; break; } // saved position too old: fall back to a recent search
    for (const h of data.history ?? []) {
      for (const a of h.messagesAdded ?? []) ids.add(a.message.id);
      for (const a of h.labelsAdded ?? []) if (a.labelIds?.includes(labelId)) ids.add(a.message.id);
    }
    page = data.nextPageToken;
  } while (page);

  if (expired) {
    const { data } = await gmail<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent(`in:inbox label:${(process.env.GMAIL_INTAKE_LABEL || "AfroFlow").replace(/\s+/g, "-")} newer_than:2d`)}&maxResults=50`);
    for (const m of data.messages ?? []) ids.add(m.id);
    res.note = "Saved Gmail position was too old; re-checked the last 2 days.";
  }

  const todo = [...ids].slice(0, MAX_PER_RUN);
  for (const id of todo) await ingestById(id, ownEmail, labelId, res);
  // Only move the bookmark when everything seen was handled, so nothing is lost if there were more than MAX_PER_RUN.
  if (ids.size <= MAX_PER_RUN) await prisma.gmailConnection.update({ where: { id: "owner" }, data: { historyId: profile.historyId } });
  else res.note = `${ids.size - MAX_PER_RUN} more emails will be picked up on the next run.`;
}

async function pushDrafts(res: SyncResult) {
  const rows = await prisma.inquiry.findMany({ where: { draftStatus: "QUEUED", draftBody: { not: null } }, orderBy: { receivedAt: "asc" }, take: 10 });
  for (const r of rows) {
    const claimed = await prisma.inquiry.updateMany({ where: { id: r.id, draftStatus: "QUEUED" }, data: { draftStatus: "IN_GMAIL", gmailDraftId: "pending" } });
    if (claimed.count === 0) continue; // another run took it
    try {
      const draftId = await createDraft(r.fromEmail, r.draftSubject ?? `Re: ${r.subject ?? ""}`, r.draftBody ?? "");
      await prisma.inquiry.update({ where: { id: r.id }, data: { gmailDraftId: draftId } });
      res.drafts++;
    } catch (e) {
      await prisma.inquiry.update({ where: { id: r.id }, data: { draftStatus: "QUEUED", gmailDraftId: null } });
      throw e;
    }
  }
}

async function sendReminders(ownEmail: string, res: SyncResult) {
  const dueBy = new Date(Date.now() + REMINDER_LEAD_HOURS * 3600_000);
  const rows = await prisma.inquiry.findMany({
    where: { status: { in: ["NEW_CUSTOMER", "EXISTING_CUSTOMER"] }, repliedAt: null, reminderSentAt: null, replyByAt: { lte: dueBy } },
    orderBy: { replyByAt: "asc" }, take: 10, include: { customer: { select: { name: true } } },
  });
  for (const r of rows) {
    const claimed = await prisma.inquiry.updateMany({ where: { id: r.id, reminderSentAt: null }, data: { reminderSentAt: new Date() } });
    if (claimed.count === 0) continue;
    const mins = Math.round((r.replyByAt.getTime() - Date.now()) / 60000);
    const who = r.customer?.name ?? r.fromEmail;
    const when = mins < 0 ? "OVERDUE" : `Reply due in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    const next = r.draftStatus !== "NONE" ? "A draft reply is ready." : "Open AfroFlow → Inquiries to draft a reply.";
    try {
      await sendMail(ownEmail, `AfroFlow reminder: ${r.subject ?? "(no subject)"}`, `${when}: "${r.subject ?? "(no subject)"}" from ${who}. ${next}`);
      res.reminders++;
      await notifyReplyDue(r.id, r.subject, who, mins).catch(() => {});
    } catch (e) {
      await prisma.inquiry.update({ where: { id: r.id }, data: { reminderSentAt: null } }); // try again next run
      throw e;
    }
  }
}

// Optional: ask Gmail to notify us instantly (needs the Pub/Sub topic from the setup steps).
async function renewWatch(expires: Date | null, res: SyncResult) {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) return;
  if (expires && expires.getTime() - Date.now() > WATCH_RENEW_BEFORE_MS) return;
  const { data } = await gmail<{ expiration: string }>("/watch", { method: "POST", body: { topicName: topic, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" } });
  await prisma.gmailConnection.update({ where: { id: "owner" }, data: { watchExpiresAt: new Date(Number(data.expiration)) } });
  res.watchRenewed = true;
}
