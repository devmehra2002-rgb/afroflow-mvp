import { prisma } from "@/lib/prisma";
import { runLeadCheck } from "./run";

const ONE_CHECK_MS = 30_000;       // a check takes ~20s; only start one if there is time left in this run
const MAX_PER_RUN = 3;
const retryAfterMs = 10 * 60_000;  // a check whose web research failed is tried once more, after 10 minutes

// Automatic lead checks for new customers. Called at the end of every sync. Nobody can trigger or override a check:
// the result is whatever the evidence and the rules say. A daily cap (LEAD_AUTO_MAX_PER_DAY, default 30) limits cost.
export async function runPendingLeadChecks(deadlineMs: number): Promise<{ checked: number; note?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { checked: 0 };
  const cap = Number(process.env.LEAD_AUTO_MAX_PER_DAY) || 30;
  const today = await prisma.leadCheck.count({ where: { createdAt: { gte: new Date(Date.now() - 86400_000) } } });
  let room = cap - today;
  if (room <= 0) return { checked: 0, note: `Daily lead-check limit (${cap}) reached.` };

  const rows = await prisma.inquiry.findMany({
    where: { status: "NEW_CUSTOMER", isBuyerEnquiry: true, receivedAt: { gte: new Date(Date.now() - 3 * 86400_000) } },
    orderBy: { receivedAt: "asc" }, take: 50,
    select: { id: true, leadChecks: { select: { research: true, createdAt: true } } },
  });
  const pending = rows.filter((r) => {
    if (r.leadChecks.length === 0) return true;
    const failed = r.leadChecks.every((c) => c.research == null);
    const newest = Math.max(...r.leadChecks.map((c) => c.createdAt.getTime()));
    return failed && r.leadChecks.length < 2 && Date.now() - newest > retryAfterMs;
  }).slice(0, MAX_PER_RUN);

  let checked = 0;
  for (const r of pending) {
    if (room <= 0 || Date.now() + ONE_CHECK_MS > deadlineMs) break;
    try { const x = await runLeadCheck(r.id); if (x.ok) { checked++; room--; } } catch (e) { console.error("lead check", e instanceof Error ? e.message : e); }
  }
  return { checked };
}
