import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowed, parseAllowList } from "@/lib/allowlist";

const allowedEmails = parseAllowList(process.env.ALLOWED_EMAILS, process.env.EXTRA_ALLOWED_EMAILS);

export const { handlers, auth, signIn, signOut } = NextAuth({
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
