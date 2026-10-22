import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { CONFIDENCE_THRESHOLD, DEFAULT_MODEL, REPLY_WINDOW_HOURS, TOTAL_STEPS, MAX_BODY_CHARS } from "@/lib/intake/constants";
import { extractEnquiry, loadPrompt, type Enquiry } from "@/lib/intake/extract";
import { clipText } from "@/lib/intake/clip";
import { applyPreviousOrderRule, parseGmailMessage, parseSender, routeInquiry, secretsMatch } from "@/lib/intake/rules";

export const maxDuration = 60;

// POST /api/intake/email
// Called by n8n for every new email in the intake inbox. Protected by the
// X-Intake-Secret header (not by Google sign-in).
// Body: { messageId?, from, subject, body, date? }
//
// 1. AI reads the email (is it a buyer enquiry? what are the details?)
// 2. Plain rules decide where it goes (see src/lib/intake/rules.ts)
// 3. It is saved. Nothing is ever turned into an order here: a person clicks
//    "Convert to order" on the Inquiry Board.
export async function POST(req: NextRequest) {
  if (!secretsMatch(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  // Accepts either plain fields ({from, subject, body, date, messageId}) or a
  // raw Gmail message straight from n8n's Gmail Trigger (has "payload"/"snippet").
  const gm = raw && (raw.payload || (raw.snippet && raw.id)) ? parseGmailMessage(raw) : null;
  const b = raw && { ...raw, from: raw.from || gm?.from, subject: raw.subject ?? gm?.subject, body: raw.body ?? gm?.body, date: raw.date ?? gm?.date, messageId: raw.messageId ?? gm?.messageId };
  const from = typeof b?.from === "string" ? b.from : "";
  const subject = typeof b?.subject === "string" ? b.subject : "";
  const body = typeof b?.body === "string" ? b.body : "";
  if (!from || (!subject && !body)) {
    return NextResponse.json({ error: "from and a subject or body are required" }, { status: 400 });
  }

  const receivedAtParsed = b?.date ? new Date(b.date) : new Date();
  const receivedAt = Number.isNaN(receivedAtParsed.getTime()) ? new Date() : receivedAtParsed;
  const messageId =
    typeof b?.messageId === "string" && b.messageId
      ? b.messageId
      : crypto.createHash("sha256").update(`${from}|${subject}|${receivedAt.toISOString()}`).digest("hex").slice(0, 32);

  // n8n can deliver the same email twice (retries): save it only once.
  const existing = await prisma.inquiry.findUnique({ where: { gmailMessageId: messageId } });
  if (existing) return NextResponse.json({ id: existing.id, status: existing.status, duplicate: true });

  const sender = parseSender(from);

  // Rule input 1: does the sender email match a known customer?
  const match = sender.email
    ? await prisma.opsCustomerEmail.findUnique({ where: { email: sender.email }, include: { customer: true } })
    : null;
  const customer = match?.customer ?? null;

  // Rule input 2: that customer's unfinished orders, and their latest order.
  const [openOrders, lastOrder] = customer
    ? await Promise.all([
        prisma.opsOrder.findMany({ where: { customerId: customer.id, doneCount: { lt: TOTAL_STEPS } }, select: { id: true, customerId: true } }),
        prisma.opsOrder.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, select: { product: true } }),
      ])
    : [[], null];

  // Step 1: AI reads. (A failure here must never lose the email.)
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const prompt = loadPrompt();
  let enquiry: Enquiry | null = null;
  let extractionError: string | null = null;
  if (!process.env.ANTHROPIC_API_KEY) {
    extractionError = "ANTHROPIC_API_KEY is not set on the server";
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
    const r = await extractEnquiry({ client, model, prompt: prompt.text, from, subject, body, today: new Date().toISOString().slice(0, 10) });
    enquiry = r.data;
    extractionError = r.error;
  }

  // Step 2: rules decide.
  let fields = enquiry?.fields ?? null;
  let productInferred = false;
  let unresolved = false;
  if (enquiry) {
    const r = applyPreviousOrderRule(enquiry, lastOrder?.product ?? null);
    fields = r.fields; productInferred = r.productInferred; unresolved = r.unresolved;
  }
  const route = routeInquiry({
    extraction: enquiry,
    extractionError,
    text: clipText(`${subject}\n${body}`, MAX_BODY_CHARS),
    customer: customer ? { id: customer.id, name: customer.name } : null,
    openOrders,
    previousOrderUnresolved: unresolved,
    repeatOrderResolved: !unresolved,
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      gmailMessageId: messageId,
      fromEmail: sender.email ?? from,
      fromName: sender.name,
      subject,
      bodyText: body.slice(0, 50_000),
      receivedAt,
      replyByAt: new Date(receivedAt.getTime() + REPLY_WINDOW_HOURS * 3600 * 1000),
      status: route.status,
      routeReason: route.routeReason,
      customerId: customer?.id ?? null,
      orderId: route.orderId ?? null,
      isBuyerEnquiry: enquiry?.isBuyerEnquiry.value ?? null,
      overallConfidence: enquiry?.overallConfidence ?? null,
      extracted: enquiry
        ? ({ isBuyerEnquiry: enquiry.isBuyerEnquiry, refersToPreviousOrder: enquiry.refersToPreviousOrder, productInferred, fields } as object)
        : undefined,
      promptVersion: prompt.version,
      model,
    },
  });

  if (route.status === "ORDER_UPDATE" && route.orderId) {
    await prisma.orderActivity.create({
      data: {
        orderId: route.orderId,
        kind: "EMAIL_RECEIVED",
        text: `Email from ${sender.name ?? sender.email}: "${subject || "(no subject)"}" — ${body.replace(/\s+/g, " ").trim().slice(0, 200)}`,
        inquiryId: inquiry.id,
      },
    });
  }

  return NextResponse.json({ id: inquiry.id, status: inquiry.status, routeReason: inquiry.routeReason, orderId: inquiry.orderId });
}
