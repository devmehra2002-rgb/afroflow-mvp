import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MODEL } from "@/lib/intake/constants";
import { gatherFacts } from "./facts";
import { loadLeadPrompt, researchSender, validateResearch, type Research } from "./research";
import { SCORE_VERSION, scoreLead } from "./score";

const CACHE_DAYS = 30;

type Fields = Record<string, { value?: unknown; confidence?: number } | null | undefined>;
const has = (f: Fields | undefined, k: string) => { const x = f?.[k]; return !!x && x.value != null && x.value !== "" && (x.confidence ?? 0) >= 0.7; };

// Runs one lead check: plain-code facts, AI web research (cached 30 days per company domain), rules score, saved.
export async function runLeadCheck(inquiryId: string): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const q = await prisma.inquiry.findUnique({ where: { id: inquiryId } });
  if (!q) return { ok: false, status: 404, error: "Not found" };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, status: 503, error: "AI key is not configured" };

  const facts = await gatherFacts(q.fromEmail);
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const { text: prompt, version } = loadLeadPrompt();
  const ex = (q.extracted ?? null) as { fields?: Fields } | null;
  const fields = ex?.fields;

  let research: Research | null = null;
  let searches = 0;
  let researchError: string | null = null;

  // Cache: same company domain checked in the last 30 days -> reuse the researched findings (free-mail is never cached).
  if (facts.domain && !facts.isFreeMail) {
    const since = new Date(Date.now() - CACHE_DAYS * 86400_000);
    const prev = await prisma.leadCheck.findFirst({ where: { domain: facts.domain, createdAt: { gte: since }, research: { not: null as never } }, orderBy: { createdAt: "desc" } });
    if (prev?.research) research = prev.research as unknown as Research;
  }
  if (!research) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 52_000, maxRetries: 0 });
    const r = await researchSender({
      client, model, prompt, fromName: q.fromName, fromEmail: q.fromEmail,
      companyHint: typeof fields?.customerName?.value === "string" ? (fields.customerName.value as string) : null,
      subject: q.subject ?? "", body: q.bodyText ?? "",
    });
    if (r.ok) { research = r.research; searches = r.searches; } else researchError = r.error;
  }

  const s = scoreLead({
    facts, research,
    extracted: fields ? { product: has(fields, "product"), quantity: has(fields, "quantity"), incoterm: has(fields, "incoterm"), destinationPort: has(fields, "destinationPort"), containerCount: typeof fields.containerCount?.value === "number" ? (fields.containerCount.value as number) : null } : null,
  });
  const reasons = researchError ? [...s.reasons, { group: "Note", text: `Web research could not run: ${researchError}`, points: 0 }] : s.reasons;

  const row = await prisma.leadCheck.create({
    data: {
      inquiryId, domain: facts.domain ?? q.fromEmail, score: s.score, tier: s.tier,
      facts: { ...facts, suggestion: s.suggestion, rawPoints: s.rawPoints, maxPoints: s.maxPoints } as object, research: (research ?? undefined) as object | undefined,
      reasons: reasons as object, scoreVersion: SCORE_VERSION, promptVersion: version, model, searches,
    },
  });
  return { ok: true, id: row.id };
}
export { validateResearch };
