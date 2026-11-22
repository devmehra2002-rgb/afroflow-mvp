import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MODEL, REPLY_WINDOW_HOURS, TOTAL_STEPS, MAX_BODY_CHARS } from "./constants";
import { extractEnquiry, loadPrompt, type Enquiry } from "./extract";
import { clipText } from "./clip";
import { applyPreviousOrderRule, parseSender, routeInquiry } from "./rules";

export type IncomingEmail = { messageId: string | null; from: string; subject: string; body: string; date: string | null };

// The one place an email becomes an inquiry. Used by the Gmail sync and by /api/intake/email.
// 1. AI reads the email  2. plain rules decide where it goes  3. it is saved.
// Nothing is ever turned into an order here: a person clicks "Convert to order".
export async function ingestEmail(b: IncomingEmail) {
  const { from, subject, body } = b;
  const receivedAtParsed = b.date ? new Date(b.date) : new Date();
  const receivedAt = Number.isNaN(receivedAtParsed.getTime()) ? new Date() : receivedAtParsed;
  const messageId =
    b.messageId
      ? b.messageId
      : crypto.createHash("sha256").update(`${from}|${subject}|${receivedAt.toISOString()}`).digest("hex").slice(0, 32);

  // The same email can arrive twice (Gmail push retries, a re-sync): save it only once.
  const existing = await prisma.inquiry.findUnique({ where: { gmailMessageId: messageId } });
  if (existing) return { id: existing.id, status: existing.status, duplicate: true as const, routeReason: existing.routeReason, orderId: existing.orderId };

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

  return { id: inquiry.id, status: inquiry.status, duplicate: false as const, routeReason: inquiry.routeReason, orderId: inquiry.orderId };
}
