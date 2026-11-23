import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { TOTAL_STEPS, DEFAULT_MODEL } from "@/lib/intake/constants";
import { classifyWithAI, parseCommand, type ClassifierClient, type Command } from "./intents";
import { HELP_TEXT, enquiriesText, ordersText, pendingText, statusText } from "./handlers";
import { decide } from "./approvals";

// Turns the owner's message into a reply. Order of trust: exact typed words first (the only way to approve, deny or hold),
// then the AI, which can only pick a read-only lookup.
export async function respond(text: string, ownerDigits: string, deps: { classifier?: ClassifierClient } = {}): Promise<{ reply: string; intent: string }> {
  let cmd: Command | null = parseCommand(text);
  if (!cmd) {
    const orders = await prisma.opsOrder.findMany({ where: { doneCount: { lt: TOTAL_STEPS } }, select: { id: true, customerName: true, product: true }, take: 40 });
    const client = deps.classifier ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 15_000, maxRetries: 0 }) : null);
    cmd = client ? await classifyWithAI({ client, model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, text, openOrders: orders.map((o) => ({ id: o.id, customer: o.customerName, product: o.product })) }) : { intent: "HELP" };
  }
  switch (cmd.intent) {
    case "APPROVE": case "DENY": case "HOLD":
      return { intent: cmd.intent, reply: await decide(cmd.intent, cmd.code, `+${ownerDigits}`, text) };
    case "ORDERS": return { intent: "ORDERS", reply: await ordersText() };
    case "STATUS": return { intent: "STATUS", reply: await statusText(cmd.orderId) };
    case "ENQUIRIES": return { intent: "ENQUIRIES", reply: await enquiriesText() };
    case "PENDING": return { intent: "PENDING", reply: await pendingText() };
    case "START": return { intent: "START", reply: `Hello, I'm AfroFlow on WhatsApp. I'll send you important updates here and answer questions.\n\n${HELP_TEXT}` };
    case "CLARIFY": return { intent: "CLARIFY", reply: "I only act on clear words. To decide something, type *APPROVE 1234* (with the code I sent), *DENY* or *HOLD*. Type *pending* to see what is waiting." };
    case "VOICE": return { intent: "VOICE", reply: "I can't listen to voice notes yet. Please type your message." };
    default: return { intent: "HELP", reply: HELP_TEXT };
  }
}
