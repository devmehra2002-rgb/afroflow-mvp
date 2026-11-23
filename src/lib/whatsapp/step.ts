import { isConfigured } from "./client";
import { sweepProformaApprovals } from "./approvals";
import { dailySummary, scanOrderDelays } from "./events";
import { flush } from "./notify";

// One pass of the WhatsApp assistant, called at the end of every sync: look for things worth telling the owner, then send.
export async function runWhatsAppStep(now = new Date()): Promise<{ queued: number; sent: number; waiting: number; note?: string }> {
  if (!isConfigured()) return { queued: 0, sent: 0, waiting: 0, note: "not configured" };
  let queued = 0;
  queued += await sweepProformaApprovals(now);
  queued += await scanOrderDelays(now);
  if (await dailySummary(now)) queued++;
  const f = await flush({ now });
  return { queued, sent: f.sent, waiting: f.waiting, note: f.note };
}
