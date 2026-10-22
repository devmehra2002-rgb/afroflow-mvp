// Step 3 checks: the reply drafter, with a MOCKED AI (no network, no key).
import { describeOrders, draftReply, loadDraftPrompt, replySubject, type PastOrder } from "../src/lib/intake/draft";
import { REMINDER_LEAD_HOURS } from "../src/lib/intake/constants";

let passed = 0, failed = 0;
function check(cond: boolean, label: string) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const orders: PastOrder[] = [{ id: "AA-2026-021", product: "Motorcycle Brake Shoes", qty: "5000 pcs", containerType: "40ft", containerCount: 1 }];

async function main() {
  // subject
  check(replySubject("Brake shoes again") === "Re: Brake shoes again", "adds Re:");
  check(replySubject("RE: hello") === "RE: hello", "does not double Re:");
  check(replySubject(null) === "Re: Your enquiry", "fallback subject");

  // order context
  check(describeOrders([]).startsWith("none"), "no orders → new customer");
  check(describeOrders(orders).includes("AA-2026-021") && describeOrders(orders).includes("1 x 40ft"), "orders listed");

  // prompt guards
  const p = loadDraftPrompt();
  check(p.version === "1.0" && /NEVER state a price/.test(p.text) && /untrusted/.test(p.text), "prompt has no-price + injection guard");
  check(REMINDER_LEAD_HOURS > 0 && REMINDER_LEAD_HOURS < 24, "reminder lead time sane");

  // happy path: the email goes in a <email> block, orders go in, text comes back
  let seen = "";
  const ok = { messages: { create: async (a: any) => { seen = a.messages[0].content; return { content: [{ type: "text", text: "  Dear James,\n\nThanks.  " }] }; } } };
  const r = await draftReply({ client: ok, prompt: p.text, fromName: "James", subject: "Brake shoes again", body: "need 2 x 40ft", orders });
  check(r.success && r.text === "Dear James,\n\nThanks.", "returns trimmed text");
  check(seen.includes("<email>") && seen.includes("AA-2026-021") && seen.includes("need 2 x 40ft"), "email + past orders reach the AI");

  // failures never throw
  const boom = { messages: { create: async () => { throw new Error("rate limited"); } } };
  const f = await draftReply({ client: boom, prompt: p.text, fromName: null, subject: "x", body: "y", orders: [] });
  check(!f.success && f.error === "rate limited", "AI error is returned, not thrown");
  const empty = { messages: { create: async () => ({ content: [] }) } };
  const e = await draftReply({ client: empty, prompt: p.text, fromName: null, subject: "x", body: "y", orders: [] });
  check(!e.success, "empty AI answer is a failure");

  // very long email is cut before it is sent
  let len = 0;
  const spy = { messages: { create: async (a: any) => { len = a.messages[0].content.length; return { content: [{ type: "text", text: "ok" }] }; } } };
  await draftReply({ client: spy, prompt: p.text, fromName: null, subject: "x", body: "a".repeat(100000), orders: [] });
  check(len < 13000, "long email is truncated");

  console.log(`draft tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
