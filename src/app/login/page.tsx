import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;

  async function googleSignIn() {
    "use server";
    try {
      await signIn("google", { redirectTo: params.callbackUrl ?? "/" });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw err;
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="brand-mark" />
        <h1>AfroFlow</h1>
        <p className="sub">Afro Asiatic Exporters</p>

        {params.error === "AccessDenied" && (
          <p className="error">
            That Google account isn&apos;t on the access list for this app.
          </p>
        )}

        <form action={googleSignIn}>
          <button type="submit" className="google-btn">
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path
                fill="#FFC107"
                d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
              />
              <path
                fill="#FF3D00"
                d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
              />
              <path
                fill="#4CAF50"
                d="M24 44c5.5 0 10.4-1.8 14.2-5l-6.6-5.4C29.5 35.4 26.9 36 24 36c-5.3 0-9.6-3.3-11.3-8l-6.6 5C9.6 39.6 16.3 44 24 44z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.6 5.4C40.9 36 44 30.6 44 24c0-1.3-.1-2.7-.4-3.5z"
              />
            </svg>
            Continue with Google
          </button>
        </form>
      </div>

      <style>{`
        .login-shell{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070f1e;font-family:system-ui,-apple-system,sans-serif;}
        .login-card{background:#fff;border-radius:16px;padding:40px 36px;width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);}
        .brand-mark{width:36px;height:36px;border-radius:10px;background:linear-gradient(155deg,#0E6E86,#0A5266);margin:0 auto 16px;}
        h1{margin:0;font-size:22px;font-weight:800;color:#0b1626;}
        .sub{margin:2px 0 24px;font-size:12px;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;}
        .error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:16px;}
        .google-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:11px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font-size:14px;font-weight:600;color:#1f2937;cursor:pointer;}
        .google-btn:hover{background:#f9fafb;}
      `}</style>
    </div>
  );
}
