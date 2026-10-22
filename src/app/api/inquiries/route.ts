import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// GET /api/inquiries — the 200 most recent inquiries, newest first.
// Statuses: NEW_CUSTOMER, EXISTING_CUSTOMER, ORDER_UPDATE, NEEDS_REVIEW,
// CONVERTED, DISMISSED. The page decides which ones to show where.
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rows = await prisma.inquiry.findMany({
    orderBy: { receivedAt: "desc" },
    take: 200,
    include: { customer: { select: { id: true, name: true, country: true } } },
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id, fromEmail: r.fromEmail, fromName: r.fromName, subject: r.subject, bodyText: r.bodyText,
      receivedAt: r.receivedAt, replyByAt: r.replyByAt, status: r.status, routeReason: r.routeReason,
      customerId: r.customerId, customerName: r.customer?.name ?? null, customerCountry: r.customer?.country ?? null,
      orderId: r.orderId, isBuyerEnquiry: r.isBuyerEnquiry, overallConfidence: r.overallConfidence,
      extracted: r.extracted,
      draftBody: r.draftBody, draftSubject: r.draftSubject, draftStatus: r.draftStatus, repliedAt: r.repliedAt,
    }))
  );
}
