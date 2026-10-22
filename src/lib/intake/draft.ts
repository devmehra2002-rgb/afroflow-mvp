import fs from "fs";
import path from "path";
import { DEFAULT_MODEL, MAX_BODY_CHARS } from "./constants";
import type { AnthropicLike } from "./extract";

export function loadDraftPrompt(): { text: string; version: string } {
  const raw = fs.readFileSync(path.join(process.cwd(), "prompts", "draft-reply.md"), "utf8");
  const m = /^version:\s*(.+)$/m.exec(raw);
  return { text: raw.replace(/^version:.*\n/, "").trim(), version: m ? m[1].trim() : "unknown" };
}

export interface PastOrder {
  id: string;
  product: string;
  qty: string | null;
  containerType: string | null;
  containerCount: number | null;
}

export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim() || "Your enquiry";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function describeOrders(orders: PastOrder[]): string {
  if (!orders.length) return "none (new customer)";
  return orders
    .map((o) => `${o.id}: ${o.product}${o.qty ? `, ${o.qty}` : ""}${o.containerCount ? `, ${o.containerCount} x ${o.containerType ?? "container"}` : ""}`)
    .join("\n");
}

export async function draftReply(params: {
  client: AnthropicLike;
  model?: string;
  prompt: string;
  fromName: string | null;
  subject: string | null;
  body: string | null;
  orders: PastOrder[];
}): Promise<{ success: boolean; text: string; error: string | null }> {
  const { client, model = DEFAULT_MODEL, prompt, fromName, subject, body, orders } = params;
  const input = `Buyer name: ${fromName || "unknown"}\n\nPrevious orders:\n${describeOrders(orders)}\n\n<email>\nSubject: ${subject ?? ""}\n\n${(body ?? "").slice(0, MAX_BODY_CHARS)}\n</email>`;
  try {
    const res = await client.messages.create({ model, max_tokens: 600, system: prompt, messages: [{ role: "user", content: input }] });
    const text = (res.content.find((b) => b.type === "text")?.text ?? "").trim();
    if (!text) return { success: false, text: "", error: "AI returned no text" };
    return { success: true, text, error: null };
  } catch (e) {
    return { success: false, text: "", error: e instanceof Error ? e.message : "AI call failed" };
  }
}
