import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // the intake route reads its prompt from /prompts at runtime
  outputFileTracingIncludes: {
    "/api/intake/email": ["./prompts/**/*"],
    "/api/inquiries/[id]/draft": ["./prompts/**/*"],
    "/api/inquiries/[id]/call": ["./prompts/**/*"],
  },
  async rewrites() {
    // Serve the existing static site unchanged at "/" — this app only adds
    // a login gate in front of it, nothing in the file itself changes.
    return [{ source: "/", destination: "/afroflow.html" }];
  },
};

export default nextConfig;
