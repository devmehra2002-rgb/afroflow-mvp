import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runLeadCheck } from "@/lib/lead/run";

export const maxDuration = 60;
const TIERS = ["STRONG", "REASONABLE", "VERIFY_FIRST", "UNVERIFIED", "STOP_AND_CHECK"];

// POST /api/inquiries/:id/lead-check — "Check this buyer": research the sender and score the lead.
// It never blocks or changes the enquiry; it only adds a badge for a person to read.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await auth())?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const r = await runLeadCheck(id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const row = await prisma.leadCheck.findUnique({ where: { id: r.id } });
  return NextResponse.json(row);
}

// PUT /api/inquiries/:id/lead-check — a person overrides the tier, with a note ({ tier, note }). tier null clears it.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await auth())?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => null);
  const tier = b?.tier === null ? null : typeof b?.tier === "string" && TIERS.includes(b.tier) ? b.tier : undefined;
  if (tier === undefined) return NextResponse.json({ error: "Unknown tier" }, { status: 400 });
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 500) : "";
  if (tier && !note) return NextResponse.json({ error: "Please add a short note explaining the override." }, { status: 400 });
  const latest = await prisma.leadCheck.findFirst({ where: { inquiryId: id }, orderBy: { createdAt: "desc" } });
  if (!latest) return NextResponse.json({ error: "No check to override" }, { status: 404 });
  const row = await prisma.leadCheck.update({ where: { id: latest.id }, data: { overrideTier: tier, overrideNote: tier ? note : null } });
  return NextResponse.json(row);
}
