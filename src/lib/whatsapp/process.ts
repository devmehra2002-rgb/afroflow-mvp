import { prisma } from "@/lib/prisma";
import { ownerNumber, type Sender } from "./client";
import { respond } from "./inbound";

// One message from the owner (already authenticated by the caller: genuine signature, owner's number).
// Handles it once (the provider may retry), answers it, and logs both sides.
export async function processOwnerMessage(m: { id: string; type: string; text: string }, sender: Sender): Promise<boolean> {
  const owner = ownerNumber();
  try { await prisma.whatsAppMessage.create({ data: { id: m.id, direction: "IN", waId: owner, kind: m.type, body: m.text.slice(0, 1000) || null } }); }
  catch (e) { if ((e as { code?: string }).code === "P2002") return false; throw e; } // already handled
  try {
    const { reply, intent } = m.type === "audio" || m.type === "voice"
      ? { reply: "I can't listen to voice notes yet. Please type your message.", intent: "VOICE" }
      : m.text ? await respond(m.text, owner) : { reply: "I can only read text messages for now.", intent: "UNSUPPORTED" };
    const sent = await sender.sendText(owner, reply);
    await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { intent } });
    await prisma.whatsAppMessage.create({ data: { id: sent.id, direction: "OUT", waId: owner, body: reply.slice(0, 1500), intent } }).catch(() => {});
  } catch (e) {
    await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { error: (e instanceof Error ? e.message : "failed").slice(0, 200) } }).catch(() => {});
    await sender.sendText(owner, "Sorry, something went wrong on my side. Please try again in a minute.").catch(() => {});
  }
  return true;
}
