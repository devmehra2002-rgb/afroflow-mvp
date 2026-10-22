// A login shortcut for running AfroFlow on your OWN computer, where the real
// Google sign-in keys do not exist. It is switched on only when ALL of these hold:
//   - the app runs in development mode (npm run dev), never a production build,
//   - it is not running on Vercel,
//   - LOCAL_DEV_AUTH=1 and LOCAL_DEV_EMAIL are set (only in your private .env.local).
// On the live site NODE_ENV is "production", so this can never switch on there.
type Env = Record<string, string | undefined>;

export function devUserEmail(env: Env = process.env): string | null {
  if (env.NODE_ENV !== "development") return null;
  if (env.VERCEL || env.VERCEL_ENV) return null;
  if (env.LOCAL_DEV_AUTH !== "1") return null;
  const email = (env.LOCAL_DEV_EMAIL ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
