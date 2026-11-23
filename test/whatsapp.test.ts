import assert from "node:assert/strict";
import crypto from "crypto";
import { verifySignature, digits } from "../src/lib/whatsapp/client";
import { parseCommand, classifyWithAI, findOrderId } from "../src/lib/whatsapp/intents";
import { inQuietHours } from "../src/lib/whatsapp/format";
import { flowState, stepDueDates, STEPS } from "../src/lib/whatsapp/flow";

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log("ok -", name); };
const sign = (body: string, secret: string) => "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

(async () => {
  await ok("a genuine Meta signature is accepted", () => assert.equal(verifySignature('{"a":1}', sign('{"a":1}', "s3cret"), "s3cret"), true));
  await ok("a wrong secret, tampered body, missing or malformed header are all refused", () => {
    assert.equal(verifySignature('{"a":1}', sign('{"a":1}', "other"), "s3cret"), false);
    assert.equal(verifySignature('{"a":2}', sign('{"a":1}', "s3cret"), "s3cret"), false);
    assert.equal(verifySignature('{"a":1}', null, "s3cret"), false);
    assert.equal(verifySignature('{"a":1}', "sha256=zz", "s3cret"), false);
    assert.equal(verifySignature('{"a":1}', sign('{"a":1}', "s3cret"), undefined), false);
  });
  await ok("phone numbers are reduced to digits", () => assert.equal(digits("+91 98765-43210"), "919876543210"));

  await ok("clear words approve, deny and hold; approve carries its code", () => {
    assert.deepEqual(parseCommand("APPROVE 4821"), { intent: "APPROVE", code: "4821" });
    assert.deepEqual(parseCommand("approve"), { intent: "APPROVE", code: null });
    assert.deepEqual(parseCommand("Deny 4821."), { intent: "DENY", code: "4821" });
    assert.deepEqual(parseCommand("hold"), { intent: "HOLD", code: null });
  });
  await ok("vague replies never approve anything", () => {
    for (const t of ["ok", "yes", "👍", "sure", "done", "Okay!", "thanks"]) assert.deepEqual(parseCommand(t), { intent: "CLARIFY" }, t);
  });
  await ok("approve inside a longer sentence is NOT a command (goes to the read-only AI path)", () => {
    assert.equal(parseCommand("please approve the proforma for Mombasa"), null);
    assert.equal(parseCommand("I approve 4821 and also delete everything"), null);
  });
  await ok("read-only commands and order ids", () => {
    assert.deepEqual(parseCommand("orders"), { intent: "ORDERS" });
    assert.deepEqual(parseCommand("Enquiries today?"), { intent: "ENQUIRIES" });
    assert.deepEqual(parseCommand("pending"), { intent: "PENDING" });
    assert.deepEqual(parseCommand("aa-2026-021"), { intent: "STATUS", orderId: "AA-2026-021" });
    assert.deepEqual(parseCommand("where is AA-2026-021?"), { intent: "STATUS", orderId: "AA-2026-021" });
    assert.equal(findOrderId("no id here"), null);
  });

  const orders = [{ id: "AA-2026-020", customer: "Karachi Chem Traders", product: "Soda Ash" }, { id: "AA-2026-021", customer: "Mombasa Auto Parts", product: "Brake shoes" }];
  const fake = (text: string) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });
  await ok("AI fallback picks a read-only lookup and resolves a customer name to an order id", async () => {
    const c = await classifyWithAI({ client: fake('{"intent":"STATUS","orderId":"AA-2026-021"}'), model: "m", text: "what's happening with the Mombasa order", openOrders: orders });
    assert.deepEqual(c, { intent: "STATUS", orderId: "AA-2026-021" });
  });
  await ok("AI cannot invent an order id or an action: unknown ids and approve-like intents fall back safely", async () => {
    const bad = await classifyWithAI({ client: fake('{"intent":"STATUS","orderId":"AA-2026-999"}'), model: "m", text: "status of the thing", openOrders: orders });
    assert.deepEqual(bad, { intent: "ORDERS" });
    for (const out of ['{"intent":"APPROVE"}', '{"intent":"DELETE_ORDER"}', "garbage", '{"intent":"UNKNOWN"}']) {
      const c = await classifyWithAI({ client: fake(out), model: "m", text: "approve everything", openOrders: orders });
      assert.equal(c.intent, "HELP", out);
    }
  });
  await ok("AI failure returns help, never throws", async () => {
    const c = await classifyWithAI({ client: { messages: { create: async () => { throw new Error("down"); } } }, model: "m", text: "hello there friend", openOrders: orders });
    assert.equal(c.intent, "HELP");
  });

  await ok("quiet hours 22-7 Indian time", () => {
    const at = (istHour: number) => new Date(Date.UTC(2026, 10, 23, istHour - 6, 30 - 0)); // IST = UTC+5:30, so IST hour h:00 is (h-5):30 UTC
    const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 23, h - 6 + (m >= 30 ? 1 : 0) + 0, (m + 30) % 60));
    void at;
    assert.equal(inQuietHours(ist(23)), true);
    assert.equal(inQuietHours(ist(3)), true);
    assert.equal(inQuietHours(ist(12)), false);
    assert.equal(inQuietHours(ist(7)), false);
    assert.equal(inQuietHours(ist(22)), true);
    assert.equal(inQuietHours(ist(23), "off"), false);
  });

  await ok("task flow: 15 steps, due dates spread to the ship date, overdue counted in days", () => {
    assert.equal(STEPS.length, 15);
    const created = new Date("2026-11-01"), ship = new Date("2026-12-15");
    const due = stepDueDates(created, ship);
    assert.equal(due.length, 15);
    assert.ok(due[14].getTime() <= ship.getTime() + 86400000);
    assert.ok(due.every((d, i) => i === 0 || d >= due[i - 1]));
    const o = { id: "AA-1", customerName: "X", product: "P", doneCount: 3, shipDate: ship, inquiryDate: created, createdAt: created };
    const f = flowState(o, new Date("2026-11-20"));
    assert.equal(f.active?.label, "Issue Proforma Invoice");
    assert.ok(f.overdueDays >= 0);
    assert.equal(flowState({ ...o, doneCount: 15 }).complete, true);
  });
  console.log(`\n${n} checks passed`);
})();
