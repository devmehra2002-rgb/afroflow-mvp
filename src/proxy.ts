import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { devUserEmail } from "@/lib/devAuth";

const realProxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
});

// On a developer's own computer only (lib/devAuth.ts) the sign-in gate is skipped.
export default devUserEmail() ? () => NextResponse.next() : realProxy;

export const config = {
  // /api/intake is exempt from the Google sign-in gate: n8n calls it with a
  // shared-secret header instead (checked inside the route).
  matcher: ["/((?!api/auth|api/intake|_next/static|_next/image|favicon.ico).*)"],
};
