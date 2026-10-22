import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MODEL } from "@/lib/intake/constants";
import { loadCompany } from "@/lib/proforma/company";
import type { VoiceDeps } from "./service";

export function voiceDeps(): VoiceDeps {
  return {
    prisma,
    bolna: { apiKey: process.env.BOLNA_API_KEY!, agentId: process.env.BOLNA_AGENT_ID!, baseUrl: process.env.BOLNA_API_URL, fromNumber: process.env.BOLNA_FROM_NUMBER },
    anthropic: process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 }) : null,
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    ourCompany: loadCompany().name,
  };
}
