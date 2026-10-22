// Voice-call trial checks: rules, Bolna requests, status handling, extraction, pre-fill.
// A fake Bolna and a fake AI are used: no phone is called and no network is touched.
import type { CallAttempt, PrismaClient } from "@prisma/client";
import { CALL_TIMEOUT_MINUTES, MAX_ATTEMPTS, canStartCall, isE164, normalizePhone, voiceCallsEnabled } from "../src/lib/voice/config";
import { getBolnaExecution, mapExecution, startBolnaCall, type FetchLike } from "../src/lib/voice/bolna";
import { CALL_FIELDS, cleanApplied, extractCallDetails, loadCallPrompt } from "../src/lib/voice/extract";
import { attemptView, overlayCallDetails, refreshAttempt, rereadAttempt, startCall, type VoiceDeps } from "../src/lib/voice/service";
import { defaultProforma } from "../src/lib/proforma/calc";

let passed = 0, failed = 0;
const check = (c: boolean, l: string) => { if (c) passed++; else { failed++; console.error("FAIL:", l); } };

const NOW = new Date("2026-10-22T10:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

// ---- a tiny in-memory stand-in for the database ----
function fakePrisma(inquiry: Record<string, unknown> | null) {
  const calls: CallAttempt[] = [];
  const db = {
    inquiry: { findUnique: async () => (inquiry ? { ...inquiry, calls: [...calls] } : null) },
    callAttempt: {
      create: async ({ data }: { data: Partial<CallAttempt> }) => { const r = { id: `c${calls.length + 1}`, inquiryId: "i1", status: "CALLING", providerStatus: null, transcript: null, durationSec: null, extracted: null, extractionError: null, applied: null, appliedBy: null, appliedAt: null, errorMessage: null, provider: "bolna", createdAt: NOW, updatedAt: NOW, ...data } as CallAttempt; calls.push(r); return r; },
      findUnique: async ({ where }: { where: { id: string } }) => calls.find((c) => c.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { id: string; inquiryId: string } }) => calls.find((c) => c.id === where.id && c.inquiryId === where.inquiryId) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<CallAttempt> }) => { const r = calls.find((c) => c.id === where.id)!; Object.assign(r, data); return r; },
      updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Partial<CallAttempt> }) => {
        const r = calls.find((c) => c.id === where.id && (!where.status || c.status === where.status));
        if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 };
      },
    },
  };
  return { db: db as unknown as PrismaClient, calls };
}

const newInquiry = { id: "i1", status: "NEW_CUSTOMER", fromName: "Chip", extracted: { fields: { product: { value: "roasted peanuts" }, quantity: { value: "1 x 20ft" } } } };

function fakeBolna(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const seen: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
  return { fetchImpl, seen };
}

const GOOD_TRANSCRIPT = "assistant: Hello, this is an AI assistant for Afro Asiatic Exporters. This call is recorded.\nuser: Yes, go ahead.\nassistant: Which company are you with?\nuser: Chip Monk Snacks, Dubai.";
const goodDetails = { spokeWithBuyer: true, buyerCompany: { value: "Chip Monk Snacks", confidence: 0.92, snippet: "Chip Monk Snacks, Dubai" }, contactPerson: null, buyerAddress: { value: "Dubai", confidence: 0.4, snippet: "Dubai" }, buyerPhone: null, buyerEmail: null, destinationPort: null, incoterm: null, paymentTerms: null, product: null, quantity: null, deliveryTime: null, notes: null };

async function main() {
  // ---- the local-only switch ----
  check(!voiceCallsEnabled({}), "off with no keys");
  check(!voiceCallsEnabled({ BOLNA_API_KEY: "k" }) && !voiceCallsEnabled({ BOLNA_AGENT_ID: "a" }), "off with only one of the two Bolna settings");
  check(voiceCallsEnabled({ BOLNA_API_KEY: "k", BOLNA_AGENT_ID: "a", NODE_ENV: "development" }), "on in development with both keys");
  check(!voiceCallsEnabled({ BOLNA_API_KEY: "k", BOLNA_AGENT_ID: "a", NODE_ENV: "production" }), "OFF in production even with keys (this is what keeps it off the live site)");
  check(voiceCallsEnabled({ BOLNA_API_KEY: "k", BOLNA_AGENT_ID: "a", NODE_ENV: "production", ALLOW_VOICE_CALLS: "1" }), "production needs an explicit opt-in");

  // ---- phone numbers ----
  check(isE164("+919876543210") && isE164("+886000000000"), "valid international numbers");
  check(!isE164("9876543210") && !isE164("+0123456789") && !isE164("+12") && !isE164("+1234567890123456") && !isE164("+91 98765 43210") && !isE164("abc"), "invalid numbers refused");
  check(normalizePhone(" +91 98765-43210 ") === "+919876543210", "tidies spaces and dashes");
  check(normalizePhone("0044 20 7946 0958") === "+00442079460958" && !isE164(normalizePhone("0044 20 7946 0958")), "a leading 00 is not guessed into a country code");
  check(normalizePhone("") === "" && normalizePhone("hello") === "", "junk becomes empty");

  // ---- who may be called, and when ----
  const ok = canStartCall({ status: "NEW_CUSTOMER" }, [], "+919876543210", true, NOW);
  check(ok.ok, "a new customer with a number and consent can be called");
  check(!canStartCall({ status: "EXISTING_CUSTOMER" }, [], "+919876543210", true, NOW).ok, "existing customers are never called");
  check(!canStartCall({ status: "NEEDS_REVIEW" }, [], "+919876543210", true, NOW).ok && !canStartCall({ status: "ORDER_UPDATE" }, [], "+919876543210", true, NOW).ok && !canStartCall({ status: "CONVERTED" }, [], "+919876543210", true, NOW).ok, "only NEW_CUSTOMER");
  check(!canStartCall({ status: "NEW_CUSTOMER" }, [], "+919876543210", false, NOW).ok, "no consent tick, no call");
  check(!canStartCall({ status: "NEW_CUSTOMER" }, [], "12345", true, NOW).ok, "bad number, no call");
  check(!canStartCall({ status: "NEW_CUSTOMER" }, [{ status: "CALLING", createdAt: ago(1) }], "+919876543210", true, NOW).ok, "one call at a time");
  check(!canStartCall({ status: "NEW_CUSTOMER" }, [{ status: "NO_ANSWER", createdAt: ago(5) }], "+919876543210", true, NOW).ok, "wait between attempts");
  check(canStartCall({ status: "NEW_CUSTOMER" }, [{ status: "NO_ANSWER", createdAt: ago(15) }], "+919876543210", true, NOW).ok, "a retry is fine after the gap");
  const many = Array.from({ length: MAX_ATTEMPTS }, (_, i) => ({ status: "NO_ANSWER", createdAt: ago(60 * (i + 1)) }));
  check(!canStartCall({ status: "NEW_CUSTOMER" }, many, "+919876543210", true, NOW).ok, `at most ${MAX_ATTEMPTS} attempts`);

  // ---- Bolna requests ----
  const f1 = fakeBolna([{ body: { message: "done", status: "queued", execution_id: "exec-1" } }]);
  const started = await startBolnaCall({ apiKey: "KEY", agentId: "AGENT", fromNumber: "+15550001111", fetchImpl: f1.fetchImpl }, { toPhone: "+919876543210", userData: { buyer_name: "Chip" } });
  const sent = JSON.parse(f1.seen[0].body ?? "{}");
  check(started.executionId === "exec-1", "returns the execution id");
  check(f1.seen[0].url === "https://api.bolna.ai/call" && f1.seen[0].method === "POST" && f1.seen[0].headers?.Authorization === "Bearer KEY", "POST /call with a Bearer key");
  check(sent.agent_id === "AGENT" && sent.recipient_phone_number === "+919876543210" && sent.from_phone_number === "+15550001111" && sent.user_data.buyer_name === "Chip", "body uses Bolna's field names");
  const f1b = fakeBolna([{ body: { execution_id: "e" } }]);
  await startBolnaCall({ apiKey: "K", agentId: "A", fetchImpl: f1b.fetchImpl }, { toPhone: "+919876543210", userData: {} });
  check(!("from_phone_number" in JSON.parse(f1b.seen[0].body ?? "{}")), "no from-number sent unless configured");
  let threw = "";
  try { await startBolnaCall({ apiKey: "K", agentId: "A", fetchImpl: fakeBolna([{ ok: false, status: 400, body: { error: 400, message: "bad agent" } }]).fetchImpl }, { toPhone: "+919876543210", userData: {} }); } catch (e) { threw = (e as Error).message; }
  check(/400/.test(threw) && /bad agent/.test(threw), "Bolna errors are reported");
  threw = "";
  try { await startBolnaCall({ apiKey: "K", agentId: "A", fetchImpl: fakeBolna([{ body: { message: "done" } }]).fetchImpl }, { toPhone: "+919876543210", userData: {} }); } catch (e) { threw = (e as Error).message; }
  check(threw !== "", "a reply without an execution id is an error");
  const f2 = fakeBolna([{ body: { id: "exec 1", status: "completed" } }]);
  await getBolnaExecution({ apiKey: "K", agentId: "A", baseUrl: "https://example.test/", fetchImpl: f2.fetchImpl }, "exec 1");
  check(f2.seen[0].url === "https://example.test/executions/exec%201", "execution id is URL-safe, custom base URL honoured");

  // ---- statuses ----
  for (const s of ["queued", "initiated", "ringing", "in-progress", "call-disconnected", "scheduled", "rescheduled"]) check(mapExecution({ status: s }).status === "CALLING", `${s} = still going`);
  check(mapExecution({ status: "no-answer" }).status === "NO_ANSWER" && mapExecution({ status: "busy" }).status === "BUSY", "no-answer and busy");
  for (const s of ["failed", "error", "canceled", "stopped", "balance-low"]) check(mapExecution({ status: s }).status === "FAILED", `${s} = failed`);
  check(/balance/i.test(mapExecution({ status: "balance-low" }).message ?? ""), "low balance says so");
  check(mapExecution({ status: "completed", conversation_duration: 42, transcript: GOOD_TRANSCRIPT }).status === "DONE", "completed with real talk = done");
  check(mapExecution({ status: "completed", conversation_duration: 0, transcript: GOOD_TRANSCRIPT }).status === "NO_CONVERSATION", "completed with zero seconds = nothing to read");
  check(mapExecution({ status: "completed", conversation_duration: 30, transcript: "assistant: Hello?\nassistant: Hello?" }).status === "NO_CONVERSATION", "completed but the buyer never spoke");
  check(mapExecution({ status: "completed", conversation_duration: 30, transcript: null }).status === "NO_CONVERSATION", "completed with no transcript");
  const vm = mapExecution({ status: "completed", conversation_duration: 9, transcript: "assistant: Hello?\n", answered_by_voice_mail: true });
  check(vm.status === "NO_CONVERSATION" && /Voicemail Detection/.test(vm.message ?? ""), "a voicemail hang-up is explained, with what to change");
  check(mapExecution({ status: "completed", conversation_duration: 30, transcript: GOOD_TRANSCRIPT, answered_by_voice_mail: true }).status === "DONE", "if the buyer did speak, voicemail flag does not discard the call");
  check(mapExecution({ status: "something-new" }).status === "CALLING" && mapExecution({}).status === "CALLING", "unknown status = keep waiting");

  // ---- extraction (fake AI) ----
  const prompt = loadCallPrompt();
  check(prompt.version === "1.0" && /untrusted/i.test(prompt.text) && /bank account/i.test(prompt.text), "prompt has the injection guard and the no-bank-details rule");
  const ai = (texts: string[]) => { let i = 0; const seen: string[] = []; return { seen, client: { messages: { create: async (a: { messages: { content: string }[] }) => { seen.push(a.messages[0].content); const t = texts[Math.min(i++, texts.length - 1)]; if (t === "THROW") throw new Error("rate limited"); return { content: [{ type: "text", text: t }] }; } } } }; };
  const a1 = ai(["```json\n" + JSON.stringify(goodDetails) + "\n```"]);
  const e1 = await extractCallDetails({ client: a1.client, prompt: prompt.text, transcript: GOOD_TRANSCRIPT });
  check(e1.data?.buyerCompany?.value === "Chip Monk Snacks" && e1.error === null, "reads a valid answer (even in code fences)");
  check(a1.seen[0].startsWith("<transcript>") && a1.seen[0].includes("Chip Monk Snacks"), "transcript goes in a <transcript> block");
  const a2 = ai(["not json", JSON.stringify(goodDetails)]);
  check((await extractCallDetails({ client: a2.client, prompt: prompt.text, transcript: GOOD_TRANSCRIPT })).data !== null, "one retry after a bad answer");
  const a3 = ai([JSON.stringify({ ...goodDetails, buyerCompany: { value: "X", confidence: 7 } })]);
  check((await extractCallDetails({ client: a3.client, prompt: prompt.text, transcript: GOOD_TRANSCRIPT })).data === null, "out-of-range confidence is rejected");
  const a4 = ai(["THROW"]);
  const e4 = await extractCallDetails({ client: a4.client, prompt: prompt.text, transcript: GOOD_TRANSCRIPT });
  check(e4.data === null && /rate limited/.test(e4.error ?? ""), "AI failure is returned, not thrown");
  const a5 = ai([JSON.stringify(goodDetails)]);
  await extractCallDetails({ client: a5.client, prompt: prompt.text, transcript: "x".repeat(100000) });
  check(a5.seen[0].length < 13000, "a huge transcript is cut");
  check(CALL_FIELDS.length === 12 && CALL_FIELDS.every(([k]) => k in goodDetails), "every field on screen exists in the schema");

  // ---- what a person saves ----
  const applied = cleanApplied({ buyerCompany: "  Chip Monk Snacks ", buyerEmail: "", unknown: "x", notes: 42, buyerAddress: "A".repeat(2000) });
  check(applied.buyerCompany === "Chip Monk Snacks" && !("buyerEmail" in applied) && !("unknown" in applied) && !("notes" in applied) && applied.buyerAddress!.length === 600, "saved details are trimmed, known fields only, length-capped");
  check(Object.keys(cleanApplied(null)).length === 0 && Object.keys(cleanApplied("nope")).length === 0, "garbage becomes nothing");

  // ---- starting a call end to end (fake DB + fake Bolna) ----
  const mk = (inq: Record<string, unknown> | null, bolnaResponses: Parameters<typeof fakeBolna>[0], anthropic: VoiceDeps["anthropic"] = null) => {
    const p = fakePrisma(inq), b = fakeBolna(bolnaResponses);
    const deps: VoiceDeps = { prisma: p.db, bolna: { apiKey: "K", agentId: "A", fetchImpl: b.fetchImpl }, anthropic, ourCompany: "Afro Asiatic Exporters", now: () => NOW };
    return { deps, ...p, bolna: b };
  };
  const s1 = mk(newInquiry, [{ body: { execution_id: "x1" } }]);
  const r1 = await startCall(s1.deps, "i1", "+919876543210", true, "dev@example.com");
  const ud = JSON.parse(s1.bolna.seen[0].body ?? "{}").user_data;
  check(r1.ok && s1.calls.length === 1 && s1.calls[0].executionId === "x1" && s1.calls[0].requestedBy === "dev@example.com", "call recorded with who asked");
  check(ud.our_company === "Afro Asiatic Exporters" && ud.buyer_name === "Chip" && ud.product === "roasted peanuts" && ud.quantity === "1 x 20ft", "the agent is told only plain facts from the enquiry");
  const s2 = mk({ ...newInquiry, status: "EXISTING_CUSTOMER" }, [{ body: { execution_id: "x" } }]);
  const r2 = await startCall(s2.deps, "i1", "+919876543210", true, "d");
  check(!r2.ok && s2.bolna.seen.length === 0 && s2.calls.length === 0, "a refused call never reaches Bolna");
  const s3 = mk(null, [{ body: {} }]);
  check(!(await startCall(s3.deps, "nope", "+919876543210", true, "d")).ok, "unknown inquiry");
  const s4 = mk(newInquiry, [{ ok: false, status: 500, body: { message: "down" } }]);
  const r4 = await startCall(s4.deps, "i1", "+919876543210", true, "d");
  check(!r4.ok && r4.status === 502 && s4.calls.length === 0, "if Bolna fails, no call record is left behind");

  // ---- following a call until it finishes ----
  const ring = mk(newInquiry, [{ body: { execution_id: "x1" } }, { body: { status: "ringing" } }, { body: { status: "completed", conversation_duration: 55, transcript: GOOD_TRANSCRIPT } }, { body: { status: "completed", conversation_duration: 55, transcript: GOOD_TRANSCRIPT } }], ai([JSON.stringify(goodDetails)]).client);
  const started1 = await startCall(ring.deps, "i1", "+919876543210", true, "d");
  const att = (started1 as { ok: true; value: CallAttempt }).value;
  const p1 = await refreshAttempt(ring.deps, att);
  check(p1.status === "CALLING" && p1.providerStatus === "ringing", "ringing is shown");
  const p2 = await refreshAttempt(ring.deps, ring.calls[0]);
  check(p2.status === "DONE" && p2.transcript === GOOD_TRANSCRIPT && p2.durationSec === 55, "finished call saves transcript and duration");
  check((p2.extracted as { buyerCompany?: { value: string } } | null)?.buyerCompany?.value === "Chip Monk Snacks", "and Claude's reading of it");
  const before = ring.bolna.seen.length;
  await refreshAttempt(ring.deps, ring.calls[0]);
  check(ring.bolna.seen.length === before, "a finished call is not asked about again");

  const noKey = mk(newInquiry, [{ body: { execution_id: "x" } }, { body: { status: "completed", conversation_duration: 20, transcript: GOOD_TRANSCRIPT } }], null);
  await startCall(noKey.deps, "i1", "+919876543210", true, "d");
  const nk = await refreshAttempt(noKey.deps, noKey.calls[0]);
  check(nk.status === "DONE" && nk.extracted === null && /ANTHROPIC_API_KEY/.test(nk.extractionError ?? ""), "no AI key: transcript saved, clear message, nothing lost");

  const nope = mk(newInquiry, [{ body: { execution_id: "x" } }, { body: { status: "no-answer" } }]);
  await startCall(nope.deps, "i1", "+919876543210", true, "d");
  const na = await refreshAttempt(nope.deps, nope.calls[0]);
  check(na.status === "NO_ANSWER" && na.transcript === null && /answered/i.test(na.errorMessage ?? ""), "no-answer is recorded plainly");

  const hiccup = mk(newInquiry, [{ body: { execution_id: "x" } }, { ok: false, status: 503, body: {} }]);
  await startCall(hiccup.deps, "i1", "+919876543210", true, "d");
  check((await refreshAttempt(hiccup.deps, hiccup.calls[0])).status === "CALLING", "a Bolna hiccup keeps the call 'in progress' and retries next time");

  const stuck = mk(newInquiry, [{ body: { execution_id: "x" } }, { body: { status: "ringing" } }]);
  await startCall(stuck.deps, "i1", "+919876543210", true, "d");
  stuck.calls[0].createdAt = ago(CALL_TIMEOUT_MINUTES + 1);
  const st = await refreshAttempt(stuck.deps, stuck.calls[0]);
  check(st.status === "FAILED" && /gave up/i.test(st.errorMessage ?? ""), "a stuck call times out");

  const race = mk(newInquiry, [{ body: { execution_id: "x" } }, { body: { status: "completed", conversation_duration: 30, transcript: GOOD_TRANSCRIPT } }], ai([JSON.stringify(goodDetails)]).client);
  await startCall(race.deps, "i1", "+919876543210", true, "d");
  const snapshot = { ...race.calls[0] };
  await Promise.all([refreshAttempt(race.deps, snapshot), refreshAttempt(race.deps, { ...snapshot })]);
  check(race.calls[0].status === "DONE" && race.calls[0].extracted !== null, "two browser tabs polling at once still end up with one clean result");

  check(!("requestedBy" in attemptView(race.calls[0])), "the screen is not sent internal fields");

  // ---- reading a finished call again once an AI key exists ----
  const nkId = noKey.calls[0].id;
  const noAi = await rereadAttempt(noKey.deps, nkId, "i1");
  check(!noAi.ok && noAi.status === 503 && /ANTHROPIC_API_KEY/.test(noAi.error), "re-read without an AI key says what is missing");
  const withAi: VoiceDeps = { ...noKey.deps, anthropic: ai([JSON.stringify(goodDetails)]).client };
  const again = await rereadAttempt(withAi, nkId, "i1");
  check(again.ok && (noKey.calls[0].extracted as { buyerCompany?: { value: string } } | null)?.buyerCompany?.value === "Chip Monk Snacks" && noKey.calls[0].extractionError === null, "re-read fills the details and clears the old message");
  check(!(await rereadAttempt(withAi, nkId, "another-inquiry")).ok && !(await rereadAttempt(withAi, "nope", "i1")).ok, "re-read only works for this inquiry's own call");
  const badAi: VoiceDeps = { ...noKey.deps, anthropic: ai(["not json"]).client };
  const bad = await rereadAttempt(badAi, nope.calls[0].id, "i1");
  check(!bad.ok, "re-read of a call with no transcript is refused");

  // ---- pre-fill the proforma from confirmed details ----
  const base = defaultProforma({ id: "AA-1", customerName: "Chip Monk Snacks", country: "UAE", product: "Peanuts", qty: "1", value: 100, terms: "TT" }, "2026-10-22");
  const o = overlayCallDetails(base, { buyerCompany: "Chip Monk Snacks LLC", buyerAddress: "Dubai Marina", buyerEmail: "chip@example.com", destinationPort: "Jebel Ali", incoterm: "CFR" });
  check(o.buyerName === "Chip Monk Snacks LLC" && o.buyerAddress === "Dubai Marina" && o.buyerEmail === "chip@example.com" && o.portOfDischarge === "Jebel Ali" && o.incoterm === "CFR", "confirmed details fill the buyer fields");
  check(o.paymentTerms === "TT" && o.buyerPhone === "" && o.lines.length === 1 && o.currency === "USD", "anything not confirmed is left alone");
  check(overlayCallDetails(base, null) === base && overlayCallDetails(base, {}).buyerName === base.buyerName, "no call details, no change");
  check(overlayCallDetails(base, { buyerCompany: "   ", incoterm: "" }).incoterm === base.incoterm, "blank values never overwrite");

  console.log(`voice tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
