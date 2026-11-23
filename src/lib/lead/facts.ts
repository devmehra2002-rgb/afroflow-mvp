import { promises as dns } from "dns";

// Plain-code facts about the sender's email domain. No AI. Every lookup has a short timeout and
// failing quietly (null) is fine: "unknown" is never treated as "bad".

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "rediffmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com", "qq.com", "163.com"]);
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com"]);

export type DomainFacts = {
  email: string | null;
  domain: string | null;
  isFreeMail: boolean;
  isDisposable: boolean;
  hasMx: boolean | null;       // null = could not check
  domainAgeDays: number | null; // null = could not check
  sanctionsChecked: false;      // not part of this version: the card says so
};

export function domainOf(email: string | null | undefined): string | null {
  const m = /^[^@\s]+@([^@\s]+)$/.exec((email ?? "").trim().toLowerCase());
  return m ? m[1] : null;
}
export const isFreeMailDomain = (d: string | null) => !!d && FREE_MAIL.has(d);
export const isDisposableDomain = (d: string | null) => !!d && DISPOSABLE.has(d);

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

let bootstrap: Record<string, string> | null = null;
async function rdapBase(tld: string): Promise<string | null> {
  if (!bootstrap) {
    const r = await withTimeout(fetch("https://data.iana.org/rdap/dns.json"), 5000);
    if (!r.ok) return null;
    const j = (await r.json()) as { services: [string[], string[]][] };
    const map: Record<string, string> = {};
    for (const [tlds, urls] of j.services) for (const t of tlds) map[t.toLowerCase()] = urls[0];
    bootstrap = map;
  }
  return bootstrap[tld] ?? null;
}

// Days since the domain was first registered, from RDAP (free). Null if the registry hides it or is unreachable.
export async function domainAgeDays(domain: string, now = Date.now()): Promise<number | null> {
  try {
    const parts = domain.split(".");
    const base = await rdapBase(parts[parts.length - 1]);
    if (!base) return null;
    const r = await withTimeout(fetch(`${base.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`, { headers: { accept: "application/rdap+json" } }), 6000);
    if (!r.ok) return null;
    const j = (await r.json()) as { events?: { eventAction: string; eventDate: string }[] };
    const reg = j.events?.find((e) => e.eventAction === "registration")?.eventDate;
    const t = reg ? Date.parse(reg) : NaN;
    return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : null;
  } catch { return null; }
}

async function hasMx(domain: string): Promise<boolean | null> {
  try {
    const r = await withTimeout(dns.resolveMx(domain), 4000);
    return r.length > 0;
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? false : null;
  }
}

export async function gatherFacts(email: string | null): Promise<DomainFacts> {
  const domain = domainOf(email);
  const base: DomainFacts = { email, domain, isFreeMail: isFreeMailDomain(domain), isDisposable: isDisposableDomain(domain), hasMx: null, domainAgeDays: null, sanctionsChecked: false };
  if (!domain || base.isFreeMail) return base; // free-mail: the domain says nothing about the company
  const [mx, age] = await Promise.all([hasMx(domain), domainAgeDays(domain)]);
  return { ...base, hasMx: mx, domainAgeDays: age };
}
