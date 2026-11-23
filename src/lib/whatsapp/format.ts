// Plain helpers for short WhatsApp wording. Times are shown in Indian time.
const IST = 5.5 * 3600_000;
export const istDate = (d: Date) => new Date(d.getTime() + IST);
export const istDay = (d: Date) => istDate(d).toISOString().slice(0, 10);
export const istHour = (d: Date) => istDate(d).getUTCHours();
export const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
export const money = (cur: string, n: number) => `${cur} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// "22-7" means quiet from 22:00 to 07:00 Indian time. "off" disables it.
export function inQuietHours(now: Date, spec = process.env.WHATSAPP_QUIET_HOURS || "22-7"): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]), h = istHour(now);
  return a === b ? false : a < b ? h >= a && h < b : h >= a || h < b;
}
