import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// POST /api/inquiries/:id/replied — a human says "I have replied": stops reminders.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const u = await prisma.inquiry.update({ where: { id }, data: { repliedAt: new Date() } });
  return NextResponse.json({ id: u.id, repliedAt: u.repliedAt });
}
