import type { PrismaClient, CallAttempt } from "@prisma/client";
import type { AnthropicLike } from "@/lib/intake/extract";
import type { ProformaData } from "@/lib/proforma/calc";
import { CALL_TIMEOUT_MINUTES, canStartCall } from "./config";
import { getBolnaExecution, mapExecution, startBolnaCall, type BolnaConfig } from "./bolna";
import { extractCallDetails, loadCallPrompt, type AppliedDetails } from "./extract";

export interface VoiceDeps {
  prisma: PrismaClient;
  bolna: BolnaConfig;
  anthropic: AnthropicLike | null; // null = no AI key: the transcript is saved, a person reads it
  model?: string;
  ourCompany: string;
  now?: () => Date;
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export async function startCall(deps: VoiceDeps, inquiryId: string, phone: string, consent: boolean, requestedBy: string): Promise<Result<CallAttempt>> {
  const inq = await deps.prisma.inquiry.findUnique({ where: { id: inquiryId }, include: { calls: true } });
  if (!inq) return { ok: false, status: 404, error: "Inquiry not found." };
  const check = canStartCall(inq, inq.calls, phone, consent, deps.now?.() ?? new Date());
  if (!check.ok) return { ok: false, status: 400, error: check.reason };

  const fields = ((inq.extracted as { fields?: Record<string, { value?: unknown } | null> } | null)?.fields) ?? {};
  const val = (k: string) => (typeof fields[k]?.value === "string" || typeof fields[k]?.value === "number" ? String(fields[k]!.value) : "");
  // Only plain facts from the enquiry go to the voice agent, as prompt variables.
  const userData = { our_company: deps.ourCompany, buyer_name: inq.fromName || val("customerName") || "there", product: val("product"), quantity: val("quantity") };

  let executionId: string;
  try {
    executionId = (await startBolnaCall(deps.bolna, { toPhone: phone, userData })).executionId;
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : "Could not start the call." };
  }
  const row = await deps.prisma.callAttempt.create({ data: { inquiryId, executionId, toPhone: phone, requestedBy } });
  return { ok: true, value: row };
}

// Asks Bolna how the call is going. When it finishes, saves the transcript and
// has Claude pull out the details. Safe to call from several browser tabs at once.
export async function refreshAttempt(deps: VoiceDeps, a: CallAttempt): Promise<CallAttempt> {
  if (a.status !== "CALLING" || !a.executionId) return a;
  const now = deps.now?.() ?? new Date();
  if (now.getTime() - a.createdAt.getTime() > CALL_TIMEOUT_MINUTES * 60_000) {
    await deps.prisma.callAttempt.updateMany({ where: { id: a.id, status: "CALLING" }, data: { status: "FAILED", errorMessage: "Gave up waiting for the call result.", updatedAt: now } });
    return (await deps.prisma.callAttempt.findUnique({ where: { id: a.id } })) ?? a;
  }
  let exec;
  try { exec = await getBolnaExecution(deps.bolna, a.executionId); }
  catch { return a; } // a hiccup talking to Bolna: try again on the next poll
  const m = mapExecution(exec);
  if (m.status === "CALLING") {
    if (exec.status && exec.status !== a.providerStatus) await deps.prisma.callAttempt.update({ where: { id: a.id }, data: { providerStatus: exec.status, updatedAt: now } });
    return { ...a, providerStatus: exec.status ?? a.providerStatus };
  }
  // First poller to see the finish claims it, so the AI runs once.
  const won = await deps.prisma.callAttempt.updateMany({
    where: { id: a.id, status: "CALLING" },
    data: { status: m.status, providerStatus: exec.status ?? null, transcript: exec.transcript ?? null, durationSec: Math.round(Number(exec.conversation_duration) || 0), errorMessage: m.message, updatedAt: now },
  });
  if (won.count === 1 && m.status === "DONE" && exec.transcript) {
    if (!deps.anthropic) {
      await deps.prisma.callAttempt.update({ where: { id: a.id }, data: { extractionError: "No AI key on this computer (ANTHROPIC_API_KEY), so the transcript is saved but the details were not read. Fill them in by hand." } });
    } else {
      const r = await extractCallDetails({ client: deps.anthropic, model: deps.model, prompt: loadCallPrompt().text, transcript: exec.transcript });
      await deps.prisma.callAttempt.update({ where: { id: a.id }, data: r.data ? { extracted: r.data as object } : { extractionError: r.error } });
    }
  }
  return (await deps.prisma.callAttempt.findUnique({ where: { id: a.id } })) ?? a;
}

// What the screen needs for one attempt.
export function attemptView(a: CallAttempt) {
  return {
    id: a.id, status: a.status, providerStatus: a.providerStatus, toPhone: a.toPhone, transcript: a.transcript, durationSec: a.durationSec,
    extracted: a.extracted, extractionError: a.extractionError, applied: a.applied, appliedBy: a.appliedBy, appliedAt: a.appliedAt,
    errorMessage: a.errorMessage, createdAt: a.createdAt,
  };
}

// Pre-fills a proforma draft's buyer fields from details a person confirmed on a call.
// Only fills what was confirmed; never overwrites with an empty value.
export function overlayCallDetails(d: ProformaData, a: AppliedDetails | null | undefined): ProformaData {
  if (!a) return d;
  const pick = (v: string | undefined, cur: string) => (v && v.trim() ? v.trim() : cur);
  return {
    ...d,
    buyerName: pick(a.buyerCompany, d.buyerName),
    buyerAddress: pick(a.buyerAddress, d.buyerAddress),
    buyerPhone: pick(a.buyerPhone, d.buyerPhone),
    buyerEmail: pick(a.buyerEmail, d.buyerEmail),
    portOfDischarge: pick(a.destinationPort, d.portOfDischarge),
    incoterm: pick(a.incoterm, d.incoterm),
    paymentTerms: pick(a.paymentTerms, d.paymentTerms),
    deliveryTime: pick(a.deliveryTime, d.deliveryTime),
  };
}
