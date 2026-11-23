import fs from "fs";
import path from "path";
import { z } from "zod";
import { clipText } from "@/lib/intake/clip";

export function loadLeadPrompt(): { text: string; version: string } {
  const raw = fs.readFileSync(path.join(process.cwd(), "prompts", "lead-research.md"), "utf8");
  const m = /^version:\s*(.+)$/m.exec(raw);
  return { text: raw.replace(/^version:.*\n/, "").trim(), version: m ? m[1].trim() : "unknown" };
}

export const SCAM_SIGNALS = ["advance_payment_request", "unverifiable_licence", "tt_copy_instead_of_payment", "urgency", "mismatched_details"] as const;
export type ScamSignal = (typeof SCAM_SIGNALS)[number];

const tri = z.boolean().nullable();
const rawSchema = z.object({
  company: z.object({ name: z.string().nullable(), website: z.string().nullable(), country: z.string().nullable(), whatTheySell: z.string().nullable() }),
  websiteMatchesCompany: tri,
  nameCompanyAgree: tri,
  independentTrace: tri,
  productFits: z.enum(["yes", "no", "unknown"]),
  findings: z.array(z.object({ kind: z.string(), text: z.string(), url: z.string(), quote: z.string(), effect: z.enum(["positive", "negative", "neutral"]) })),
  scamSignals: z.array(z.object({ signal: z.string(), quote: z.string() })),
  notes: z.string().optional().default(""),
});
export type RawResearch = z.infer<typeof rawSchema>;

export type Research = Omit<RawResearch, "scamSignals" | "findings"> & {
  findings: RawResearch["findings"];
  scamSignals: { signal: ScamSignal; quote: string }[];
  dropped: string[]; // what validation threw away, shown for transparency
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// The AI's claims only count if the code can verify them:
//  - a finding needs a URL that really appeared in the search results of this very request
//  - a scam signal needs a quote that really appears in the email text
//  - the "website matches" / "independent trace" claims need at least one verified finding behind them
export function validateResearch(raw: RawResearch, searchedUrls: string[], emailText: string): Research {
  const dropped: string[] = [];
  const allowed = new Set(searchedUrls.map((u) => u.replace(/\/$/, "")));
  const findings = raw.findings.filter((f) => {
    const ok = allowed.has(f.url.replace(/\/$/, "")) && f.quote.trim().length > 0;
    if (!ok) dropped.push(`finding without a verifiable link: ${f.text.slice(0, 60)}`);
    return ok;
  });
  const hay = norm(emailText);
  const scamSignals = raw.scamSignals.flatMap((s) => {
    const signal = SCAM_SIGNALS.find((x) => x === s.signal);
    if (!signal || !s.quote.trim() || !hay.includes(norm(s.quote))) { dropped.push(`scam signal not found in the email: ${s.signal}`); return []; }
    return [{ signal, quote: s.quote }];
  });
  const hasSite = findings.some((f) => f.kind === "website" && f.effect !== "negative");
  const hasTrace = findings.some((f) => ["registry", "directory", "news", "marketplace"].includes(f.kind) && f.effect !== "negative");
  if (raw.websiteMatchesCompany && !hasSite) dropped.push("'website matches' claim has no verified website finding");
  if (raw.independentTrace && !hasTrace) dropped.push("'independent trace' claim has no verified finding");
  // a website's own domain should not be a different company's: keep the claim only if verified findings exist
  return {
    ...raw,
    websiteMatchesCompany: raw.websiteMatchesCompany && hasSite ? true : raw.websiteMatchesCompany === false ? false : null,
    independentTrace: raw.independentTrace && hasTrace ? true : raw.independentTrace === false ? false : null,
    findings, scamSignals, dropped,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any;
export interface LeadClientLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: { create: (p: any) => Promise<{ content: Block[]; stop_reason?: string | null; usage?: any }> };
}

export function parseResearchJson(text: string): RawResearch | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  const s = fence ? fence[1] : a !== -1 && b > a ? text.slice(a, b + 1) : text;
  try { const r = rawSchema.safeParse(JSON.parse(s)); return r.success ? r.data : null; } catch { return null; }
}

export async function researchSender(p: {
  client: LeadClientLike; model: string; prompt: string;
  fromName: string | null; fromEmail: string; companyHint: string | null; subject: string; body: string;
}): Promise<{ ok: true; research: Research; searches: number } | { ok: false; error: string }> {
  const emailText = `${p.subject}\n${p.body}`;
  const user = `<untrusted_email>\nFrom: ${p.fromName ?? ""} <${p.fromEmail}>\nCompany named by AI reader: ${p.companyHint ?? "(none)"}\nSubject: ${p.subject}\n\n${clipText(p.body, 6000)}\n</untrusted_email>\n\nResearch the sender's company and return the JSON.`;
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: user }];
  const urls: string[] = [];
  let searches = 0;
  try {
    for (let round = 0; round < 3; round++) {
      const r = await p.client.messages.create({
        model: p.model, max_tokens: 3000, system: p.prompt, messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      });
      searches += r.usage?.server_tool_use?.web_search_requests ?? 0;
      for (const b of r.content as Block[]) {
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
          for (const x of b.content as { url?: string }[]) if (x.url) urls.push(x.url);
        }
      }
      if (r.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: r.content }); continue; }
      const text = r.content.filter((b: Block) => b.type === "text").map((b: Block) => b.text ?? "").join("\n");
      const raw = parseResearchJson(text);
      if (!raw) return { ok: false, error: "The AI did not return findings in the expected format." };
      return { ok: true, research: validateResearch(raw, urls, emailText), searches };
    }
    return { ok: false, error: "The research took too long." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "research failed" };
  }
}
export { host as _host };
