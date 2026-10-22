import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MODEL } from "@/lib/intake/constants";
import { draftReply, loadDraftPrompt, replySubject } from "@/lib/intake/draft";

export const maxDuration = 60;

// POST /api/inquiries/:id/draft — Claude writes a first reply from the email and
// the customer's earlier orders. It is only saved as a draft for a human to edit.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const q = await prisma.inquiry.findUnique({ where: { id } });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI key is not configured" }, { status: 503 });

  const orders = q.customerId
    ? await prisma.opsOrder.findMany({
        where: { customerId: q.customerId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, product: true, qty: true, containerType: true, containerCount: true },
      })
    : [];
  const { text: prompt, version } = loadDraftPrompt();
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const r = await draftReply({ client, model, prompt, fromName: q.fromName, subject: q.subject, body: q.bodyText, orders });
  if (!r.success) return NextResponse.json({ error: "Could not write a draft — try again, or write the reply yourself." }, { status: 502 });

  const updated = await prisma.inquiry.update({
    where: { id },
    data: { draftBody: r.text, draftSubject: replySubject(q.subject), draftStatus: "DRAFTED", draftModel: `${model} / draft-reply v${version}`, gmailDraftId: null },
  });
  return NextResponse.json({ draftBody: updated.draftBody, draftSubject: updated.draftSubject, draftStatus: updated.draftStatus });
}

// PUT /api/inquiries/:id/draft — a human saves their edits, and optionally
// queues the draft so n8n puts it in Gmail Drafts ({ draftBody, queue }).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const body = typeof b?.draftBody === "string" ? b.draftBody.trim() : "";
  if (!body) return NextResponse.json({ error: "The reply is empty" }, { status: 400 });
  const q = await prisma.inquiry.findUnique({ where: { id }, select: { subject: true } });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await prisma.inquiry.update({
    where: { id },
    data: { draftBody: body, draftSubject: replySubject(q.subject), draftStatus: b?.queue ? "QUEUED" : "DRAFTED", ...(b?.queue ? { gmailDraftId: null } : {}) },
  });
  return NextResponse.json({ draftBody: updated.draftBody, draftSubject: updated.draftSubject, draftStatus: updated.draftStatus });
}
