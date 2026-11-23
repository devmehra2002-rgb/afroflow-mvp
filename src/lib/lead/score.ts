import type { DomainFacts } from "./facts";
import type { Research, ScamSignal } from "./research";

// The score and the tier are decided HERE, by plain rules. The AI only supplies findings (with links).
// Same input always gives the same answer. Rubric agreed in the blueprint; tune the numbers below.
export const SCORE_VERSION = "1.1";
// Identity 30 + Footprint 20 + Request realism 15 + Message quality 10. The 15 "history with us" points cannot be
// earned by a new buyer, so the raw points are scaled to 100 over these 75: a perfect new buyer scores 100.
export const MAX_EARNABLE = 75;

export type Tier = "STRONG" | "REASONABLE" | "VERIFY_FIRST" | "UNVERIFIED" | "STOP_AND_CHECK";
export type Reason = { group: string; text: string; points: number; url?: string };

export type ScoreInput = {
  facts: DomainFacts;
  research: Research | null; // null = research could not run
  extracted: { product?: boolean; quantity?: boolean; incoterm?: boolean; destinationPort?: boolean; containerCount?: number | null } | null;
  sanctionsPossibleMatch?: boolean | null; // null/undefined = not checked in this version
};

const PENALTY: Record<ScamSignal, [number, string]> = {
  advance_payment_request: [-10, "Asks you to pay or send money first"],
  unverifiable_licence: [-8, "Offers a trade licence that cannot be verified"],
  tt_copy_instead_of_payment: [-10, "Offers a \"TT copy\" instead of payment"],
  urgency: [-4, "Unusual urgency"],
  mismatched_details: [-8, "Sender, company or country details contradict each other"],
};

export function scoreLead(i: ScoreInput): { score: number; rawPoints: number; maxPoints: number; tier: Tier; reasons: Reason[]; suggestion: string } {
  const R: Reason[] = [];
  const add = (group: string, text: string, points: number, url?: string) => R.push({ group, text, points, url });
  const f = i.facts, r = i.research;
  const firstUrl = (kind: string[]) => r?.findings.find((x) => kind.includes(x.kind) && x.effect !== "negative")?.url;

  // Identity consistency (30)
  const companyDomain = !!f.domain && !f.isFreeMail && !f.isDisposable && f.hasMx !== false;
  if (companyDomain) add("Identity", `Writes from a company email domain (${f.domain})`, 10);
  else if (f.isDisposable) add("Identity", "Writes from a disposable email address", 0);
  else if (f.isFreeMail) add("Identity", "Writes from a free-mail address (common for small buyers; says nothing either way)", 0);
  else if (f.hasMx === false) add("Identity", "The email domain cannot receive mail, so a reply would not reach them", 0);
  if (r?.websiteMatchesCompany) add("Identity", "A website was found that matches the company named", 10, firstUrl(["website"]));
  if (r?.nameCompanyAgree) add("Identity", "Sender name and company agree with what the web shows", 10, firstUrl(["website", "directory", "registry"]));

  // Footprint (20)
  if (f.domainAgeDays != null) {
    if (f.domainAgeDays > 730) add("Footprint", `Domain registered over 2 years ago`, 8);
    else if (f.domainAgeDays >= 180) add("Footprint", `Domain registered ${Math.round(f.domainAgeDays / 30)} months ago`, 4);
    else add("Footprint", `Domain is very new (${f.domainAgeDays} days old)`, 0);
  }
  if (r?.independentTrace) add("Footprint", "An independent trace of the company was found (registry, directory, news or marketplace)", 12, firstUrl(["registry", "directory", "news", "marketplace"]));

  // Request realism (15)
  if (r?.productFits === "yes") add("Request", "The product requested fits what this company sells or imports", 9);
  else if (r?.productFits === "unknown") add("Request", "Could not tell whether the product fits their business", 3);
  const cc = i.extracted?.containerCount;
  if (cc != null && cc >= 1 && cc <= 20) add("Request", "Quantity is plausible", 3);
  if (i.extracted?.destinationPort) add("Request", "A destination port was given", 3);

  // History with us (15): leads here are new senders, so no history yet.
  // (A known customer with resolved orders would earn up to 15; those are not checked by default.)

  // Message quality (10)
  const mq = (i.extracted?.product ? 3 : 0) + (i.extracted?.quantity ? 3 : 0) + (i.extracted?.incoterm ? 2 : 0) + (i.extracted?.destinationPort ? 2 : 0);
  if (mq > 0) add("Message", "The enquiry is specific (product, quantity, terms)", mq);

  // Scam signals (up to -30)
  let pen = 0;
  for (const s of r?.scamSignals ?? []) { const [p, t] = PENALTY[s.signal]; pen += p; add("Warning", `${t}: "${s.quote.slice(0, 80)}"`, p); }
  if (f.isFreeMail && (cc ?? 0) >= 5) { pen -= 5; add("Warning", "Free-mail address with a very large order", -5); }
  if (f.hasMx === false && f.domain && !f.isFreeMail) { pen -= 8; add("Warning", "The email domain cannot receive mail", -8); }
  if (r?.websiteMatchesCompany === false) { pen -= 6; add("Warning", "A website was found but does not match the company named", -6); }
  const negFinding = r?.findings.find((x) => x.effect === "negative");
  if (negFinding) { pen -= 6; add("Warning", `Negative finding: ${negFinding.text.slice(0, 100)}`, -6, negFinding.url); }
  if (pen < -30) { add("Warning", "Total penalties are capped at -30", -30 - pen); }

  const rawPoints = R.reduce((a, x) => a + x.points, 0);
  const score = Math.max(0, Math.min(100, Math.round((rawPoints / MAX_EARNABLE) * 100)));
  const negative = R.some((x) => x.group === "Warning" && x.points < 0);
  let tier: Tier;
  if (i.sanctionsPossibleMatch === true) tier = "STOP_AND_CHECK";
  else if (score >= 75) tier = "STRONG";
  else if (score >= 50) tier = "REASONABLE";
  else if (negative) tier = "VERIFY_FIRST";
  else tier = "UNVERIFIED";

  const suggestion = {
    STRONG: "Proceed as normal.",
    REASONABLE: "Proceed, and confirm the details in your reply.",
    VERIFY_FIRST: "Ask for company registration and a trade reference before quoting.",
    UNVERIFIED: "Little evidence either way. Treat as unknown, not bad: a small genuine buyer may have no web presence.",
    STOP_AND_CHECK: "Possible sanctions match: do not engage until a person has checked.",
  }[tier];
  return { score, rawPoints, maxPoints: MAX_EARNABLE, tier, reasons: R, suggestion };
}
