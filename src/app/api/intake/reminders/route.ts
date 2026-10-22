import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REMINDER_LEAD_HOURS } from "@/lib/intake/constants";
import { secretsMatch } from "@/lib/intake/rules";

// GET /api/intake/reminders — n8n asks: which open enquiries are close to their
// 24h reply deadline and have not been nudged yet? Protected by X-Intake-Secret.
export async function GET(req: NextRequest) {
  if (!secretsMatch(req.headers.get("x-intake-secret"), process.env.INTAKE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dueBy = new Date(Date.now() + REMINDER_LEAD_HOURS * 3600_000);
  const rows = await prisma.inquiry.findMany({
    where: {
      status: { in: ["NEW_CUSTOMER", "EXISTING_CUSTOMER"] },
      repliedAt: null,
      reminderSentAt: null,
      replyByAt: { lte: dueBy },
    },
    orderBy: { replyByAt: "asc" },
    take: 20,
    include: { customer: { select: { name: true } } },
  });
  return NextResponse.json(
    rows.map((r) => {
      const mins = Math.round((r.replyByAt.getTime() - Date.now()) / 60000);
      return {
        id: r.id,
        subject: r.subject,
        from: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail,
        customer: r.customer?.name ?? null,
        replyByAt: r.replyByAt,
        minutesLeft: mins,
        overdue: mins < 0,
        hasDraft: r.draftStatus !== "NONE",
        message: `${mins < 0 ? "OVERDUE" : `Reply due in ${Math.floor(mins / 60)}h ${mins % 60}m`}: "${r.subject ?? "(no subject)"}" from ${r.customer?.name ?? r.fromEmail}. ${r.draftStatus !== "NONE" ? "A draft reply is ready." : "Open AfroFlow → Inquiries to draft a reply."}`,
      };
    })
  );
}
