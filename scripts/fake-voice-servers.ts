// Stand-ins for Bolna and Claude so the whole call flow can be tried on a laptop with
// NO real phone call and NO cost. Fake data only.
//   npx tsx scripts/fake-voice-servers.ts
// Bolna runs on :4010, Claude on :4011. The "call" takes about 14 seconds:
// queued -> ringing -> in-progress -> completed (with a scripted transcript).
import http from "http";

const calls = new Map<string, number>(); // execution id -> started at
const TRANSCRIPT = [
  "assistant: Hello, this is an AI assistant calling on behalf of Afro Asiatic Exporters. This call is recorded. Am I speaking with Chip?",
  "user: Yes, speaking. Go ahead.",
  "assistant: Thank you. Which company are you with?",
  "user: Chip Monk Snacks Trading LLC, based in Dubai.",
  "assistant: Could you give me the address?",
  "user: Office 12, Business Bay Tower, Dubai, United Arab Emirates.",
  "assistant: And an email address for the invoice?",
  "user: It is c h i p at chipmonk dash snacks dot example.",
  "assistant: Chip at chipmonk-snacks dot example, is that correct?",
  "user: Yes that is right.",
  "assistant: Which destination port, and which delivery terms do you prefer?",
  "user: Jebel Ali, and CFR please. We will pay by bank transfer, delivery by end of January.",
  "assistant: Thank you. Our team will be in touch with a quotation. Goodbye.",
  "user: Thanks, bye.",
].join("\n");

const DETAILS = {
  spokeWithBuyer: true,
  buyerCompany: { value: "Chip Monk Snacks Trading LLC", confidence: 0.95, snippet: "Chip Monk Snacks Trading LLC, based in Dubai" },
  contactPerson: { value: "Chip", confidence: 0.85, snippet: "Yes, speaking" },
  buyerAddress: { value: "Office 12, Business Bay Tower, Dubai, United Arab Emirates", confidence: 0.9, snippet: "Office 12, Business Bay Tower" },
  buyerPhone: null,
  buyerEmail: { value: "chip@chipmonk-snacks.example", confidence: 0.55, snippet: "c h i p at chipmonk dash snacks dot example" },
  destinationPort: { value: "Jebel Ali", confidence: 0.95, snippet: "Jebel Ali" },
  incoterm: { value: "CFR", confidence: 0.9, snippet: "CFR please" },
  paymentTerms: { value: "Bank transfer", confidence: 0.85, snippet: "pay by bank transfer" },
  product: null, quantity: null,
  deliveryTime: { value: "By end of January", confidence: 0.9, snippet: "delivery by end of January" },
  notes: null,
};

const send = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req: http.IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/call") {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (!body.agent_id || !body.recipient_phone_number) return send(res, 400, { error: 400, message: "agent_id and recipient_phone_number are required" });
    const id = `fake-${Date.now()}`; calls.set(id, Date.now());
    console.log("[fake bolna] call to", body.recipient_phone_number, "with", JSON.stringify(body.user_data));
    return send(res, 200, { message: "done", status: "queued", execution_id: id });
  }
  const m = /^\/executions\/([^/]+)$/.exec(req.url ?? "");
  if (req.method === "GET" && m) {
    const t = calls.get(decodeURIComponent(m[1]));
    if (t === undefined) return send(res, 400, { error: 400, message: "unknown execution" });
    const s = (Date.now() - t) / 1000;
    if (s < 4) return send(res, 200, { id: m[1], status: "queued" });
    if (s < 8) return send(res, 200, { id: m[1], status: "ringing" });
    if (s < 14) return send(res, 200, { id: m[1], status: "in-progress" });
    return send(res, 200, { id: m[1], status: "completed", conversation_duration: 47, transcript: TRANSCRIPT, extracted_data: {}, error_message: null });
  }
  send(res, 404, { error: 404, message: "not found" });
}).listen(4010, () => console.log("fake Bolna on http://localhost:4010"));

http.createServer(async (req, res) => {
  if (req.method === "POST" && /\/v1\/messages/.test(req.url ?? "")) {
    await readBody(req);
    console.log("[fake claude] read a transcript");
    return send(res, 200, { id: "msg_fake", type: "message", role: "assistant", model: "fake", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(DETAILS) }], usage: { input_tokens: 1, output_tokens: 1 } });
  }
  send(res, 404, { error: "not found" });
}).listen(4011, () => console.log("fake Claude on http://localhost:4011"));
