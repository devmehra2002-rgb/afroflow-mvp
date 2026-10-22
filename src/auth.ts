import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowed, parseAllowList } from "@/lib/allowlist";
import { devUserEmail } from "@/lib/devAuth";

const allowedEmails = parseAllowList(process.env.ALLOWED_EMAILS, process.env.EXTRA_ALLOWED_EMAILS);

const nextAuth = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // The allowlist gate: only emails in ALLOWED_EMAILS / EXTRA_ALLOWED_EMAILS may sign in.
    async signIn({ user }) {
      return isAllowed(user.email, allowedEmails);
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

// Normally exactly the real auth(). On a developer's own computer only (see
// lib/devAuth.ts) a call with no arguments returns a fixed local user instead.
export const auth: typeof nextAuth.auth = ((...args: unknown[]) => {
  const dev = devUserEmail();
  if (dev && args.length === 0) return Promise.resolve({ user: { email: dev, name: "Local developer" }, expires: new Date(Date.now() + 86_400_000).toISOString() });
  return (nextAuth.auth as (...a: unknown[]) => unknown)(...args);
}) as typeof nextAuth.auth;
