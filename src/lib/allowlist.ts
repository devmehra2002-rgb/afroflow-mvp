// Who may sign in. ALLOWED_EMAILS is the main list; EXTRA_ALLOWED_EMAILS lets
// people be added without rewriting (or having to read) the main one.
export function parseAllowList(...lists: Array<string | undefined>): string[] {
  const all = lists.flatMap((l) => (l ?? "").split(","));
  return [...new Set(all.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

export function isAllowed(email: string | null | undefined, allowed: string[]): boolean {
  return !!email && allowed.includes(email.trim().toLowerCase());
}
