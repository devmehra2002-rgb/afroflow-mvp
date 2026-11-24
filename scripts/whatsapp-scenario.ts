// Runs the WhatsApp assistant end to end against the real database with a PRETEND sender (nothing is sent to anyone).
// It creates a throwaway order and removes everything it made. Run: set -a; . ./.env; . ./.env.local; set +a; npx tsx scripts/whatsapp-scenario.ts
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
process.env.OWNER_WHATSAPP = "910000000001"; process.env.WHATSAPP_TOKEN = "x"; process.env.WHATSAPP_PHONE_NUMBER_ID = "y"; process.env.WHATSAPP_QUIET_HOURS = "off";
delete process.env.WHATSAPP_TEMPLATE_NAME;
(async () => {
  const { sweepProformaApprovals } = await import("../src/lib/whatsapp/approvals");
  const { respond } = await import("../src/lib/whatsapp/inbound");
  const { flush, enqueue, windowOpen } = await import("../src/lib/whatsapp/notify");
  const OID = "AA-TEST-WA1";
  const sent: string[] = [], tmpl: string[] = [];
  const sender = { sendText: async (_t: string, b: string) => { sent.push(b); return { id: "out-" + sent.length + Math.random() }; }, sendTemplate: async (_t: string, n: string, _l: string, a: string[]) => { tmpl.push(a[0]); return { id: "tm-" + Math.random() }; } };
  const t0 = new Date();
  const clean = async () => {
    await p.notification.deleteMany({ where: { createdAt: { gte: t0 } } }); await p.approvalRequest.deleteMany({ where: { createdAt: { gte: t0 } } });
    await p.approvalRequest.deleteMany({ where: { refId: OID } }); await p.orderProforma.deleteMany({ where: { orderId: OID } });
    await p.orderActivity.deleteMany({ where: { orderId: OID } }); await p.opsOrder.deleteMany({ where: { id: OID } });
    await p.notification.deleteMany({ where: { dedupeKey: { startsWith: "t-" } } }); await p.whatsAppMessage.deleteMany({ where: { waId: "910000000001" } });
    await p.notification.deleteMany({ where: { text: { contains: "AA-TEST-WA1" } } });
  };
  await clean();
  try {
    await p.opsOrder.create({ data: { id: OID, customerName: "Test Buyer Co", product: "Test Rice", value: 1000, shipDate: new Date(Date.now() + 40 * 864e5), doneCount: 3, docSteps: [] } });
    const data = (price: number) => ({ buyerName: "Test Buyer Co", buyerAddress: "", buyerPhone: "", buyerEmail: "", buyerRef: "", currency: "USD", exchangeRateToInr: null, incoterm: "CIF", portOfLoading: "Chennai", portOfDischarge: "Jebel Ali", countryOfOrigin: "India", paymentTerms: "LC", shipmentMode: "Sea", deliveryTime: "", packing: "", issueDate: "2026-11-23", validUntil: "2026-12-23", notes: "", termsText: "", lines: [{ code: "R1", description: "Rice", hsn: "1006", quantity: 10, unit: "MT", unitPrice: price }] });
    const old = new Date(Date.now() - 20 * 60_000);
    await p.orderProforma.create({ data: { orderId: OID, number: "PI/TEST/1", data: data(500) as object, createdAt: old, updatedAt: old } });

    // 1. the sweep asks for approval, once
    assert.ok((await sweepProformaApprovals()) >= 1); assert.equal(await sweepProformaApprovals(), 0);
    let ap = await p.approvalRequest.findFirstOrThrow({ where: { refId: OID, status: "PENDING" } });
    console.log("ok - sweep created one pending approval with a 4-digit code:", /^\d{4}$/.test(ap.code));

    // 2. window closed (owner never wrote): nothing is sent
    let f = await flush({ sender }); assert.equal(sent.length, 0); console.log("ok - nothing sent while the 24h window is closed:", f.note);

    // 3. owner writes "start": window opens; approval request is delivered
    await p.whatsAppMessage.create({ data: { id: "in-1", direction: "IN", waId: "910000000001", body: "start" } });
    assert.equal(await windowOpen(), true);
    f = await flush({ sender }); assert.ok(sent.some((s) => s.includes("Approval needed") && s.includes(ap.code))); console.log("ok - approval request delivered once the window opened");
    sent.length = 0; f = await flush({ sender }); assert.equal(sent.length, 0); console.log("ok - not sent twice");

    // 4. vague / bare / wrong-code replies do NOT approve
    const r1 = await respond("ok", "910000000001"); const r2 = await respond("approve", "910000000001"); const r3 = await respond("approve 0000", "910000000001");
    assert.ok(/clear words/.test(r1.reply) && /APPROVE \d{4}/.test(r2.reply) && /don't have a request/.test(r3.reply));
    assert.equal((await p.orderProforma.findUniqueOrThrow({ where: { orderId: OID } })).status, "DRAFT"); console.log("ok - 'ok', bare 'approve' and a wrong code approve nothing");

    // 5. the proforma changes after the request: an old approve is refused
    await p.orderProforma.update({ where: { orderId: OID }, data: { data: data(900) as object, updatedAt: new Date() } });
    const r4 = await respond(`approve ${ap.code}`, "910000000001");
    assert.ok(/changed after I asked you/.test(r4.reply)); assert.equal((await p.orderProforma.findUniqueOrThrow({ where: { orderId: OID } })).status, "DRAFT");
    assert.equal((await p.approvalRequest.findUniqueOrThrow({ where: { id: ap.id } })).status, "STALE"); console.log("ok - approve of an old version is refused and marked stale");

    // 6. after it settles, a NEW request is made for the new version; approving it with its code works
    await p.orderProforma.update({ where: { orderId: OID }, data: { updatedAt: old } });
    assert.ok((await sweepProformaApprovals()) >= 1);
    ap = await p.approvalRequest.findFirstOrThrow({ where: { refId: OID, status: "PENDING" } });
    const r5 = await respond(`APPROVE ${ap.code}`, "910000000001");
    const pf = await p.orderProforma.findUniqueOrThrow({ where: { orderId: OID } });
    assert.equal(pf.status, "APPROVED"); assert.ok(pf.approvedBy?.startsWith("WhatsApp")); assert.ok(/approved and locked/.test(r5.reply));
    assert.equal((await p.approvalRequest.findUniqueOrThrow({ where: { id: ap.id } })).status, "APPROVED"); console.log("ok - approving the current version with its code locks the proforma, logged as WhatsApp");
    const again = await respond(`approve ${ap.code}`, "910000000001"); assert.ok(/no longer open|Nothing is waiting/.test(again.reply)); console.log("ok - replaying the approval does nothing");

    // 7. read-only answers
    const o = await respond("orders", "910000000001"); assert.ok(o.reply.includes(OID)); const s = await respond(OID, "910000000001"); assert.ok(s.reply.includes("Test Buyer Co") && /Now:/.test(s.reply)); console.log("ok - orders and task-flow answers");

    // 8. batching: 3+ small updates become one message; template used when the window is closed
    sent.length = 0;
    for (let i = 0; i < 3; i++) await enqueue({ kind: "NEW_ENQUIRY", dedupeKey: `t-${i}`, text: `*New enquiry*: Batch ${i}` });
    assert.equal(await enqueue({ kind: "NEW_ENQUIRY", dedupeKey: "t-0", text: "dup" }), false);
    await flush({ sender }); assert.equal(sent.length, 1); assert.ok(sent[0].includes("3 updates")); console.log("ok - 3 small updates sent as one message; duplicate key ignored");
    await p.whatsAppMessage.deleteMany({ where: { direction: "IN" } }); process.env.WHATSAPP_TEMPLATE_NAME = "afroflow_alert";
    await enqueue({ kind: "ORDER_DELAY", dedupeKey: "t-9", text: "*AA-X*: late\nsecond line" }); await flush({ sender });
    assert.equal(tmpl.length, 1); assert.ok(!tmpl[0].includes("\n") && !tmpl[0].includes("*")); console.log("ok - closed window uses the template, flattened to one line");
    // 8b. Meta's "business account locked" (131031) must not burn retries: the alert stays waiting
    await p.whatsAppMessage.create({ data: { id: "in-lock", direction: "IN", waId: "910000000001", body: "orders" } });
    delete process.env.WHATSAPP_TEMPLATE_NAME;
    await enqueue({ kind: "ORDER_DELAY", dedupeKey: "t-lock", text: "*AA-X*: lock test" });
    const locked = { sendText: async () => { throw new Error("WhatsApp send failed (400, code 131031): Business Account locked"); }, sendTemplate: async () => { throw new Error("x"); } };
    const lf = await flush({ sender: locked });
    const lockedRow = await p.notification.findUniqueOrThrow({ where: { dedupeKey: "t-lock" } });
    assert.equal(lockedRow.status, "PENDING"); assert.equal(lockedRow.attempts, 0); assert.ok(/locked by Meta/.test(lf.note ?? "")); console.log("ok - Meta account lock (131031) leaves alerts waiting and burns no retries");
    // 9. owner-only is enforced in the webhook (checked by code review + below) / expiry
    await p.notification.create({ data: { kind: "NEW_ENQUIRY", dedupeKey: "t-old", text: "old", createdAt: new Date(Date.now() - 30 * 3600_000) } });
    f = await flush({ sender }); assert.ok(f.expired >= 1); console.log("ok - items older than a day expire instead of arriving late");
    console.log("\nALL SCENARIO CHECKS PASSED");
  } finally { await clean(); await p.$disconnect(); }
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
