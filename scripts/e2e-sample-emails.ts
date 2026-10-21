// End-to-end test of the intake endpoint using the 5 sample emails.
// It sends them exactly like n8n would (HTTP + secret header) and checks where
// each one landed. Run:
//   BASE_URL=https://afroflow-login.vercel.app INTAKE_SECRET=... npx tsx scripts/e2e-sample-emails.ts
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const base = process.env.BASE_URL ?? "";
const secret = process.env.INTAKE_SECRET ?? "";
if (!base || !secret) { console.error("Set BASE_URL and INTAKE_SECRET"); process.exit(1); }

(async () => {
  const prisma = new PrismaClient();
  const cust = await prisma.opsCustomer.findFirst({ where: { name: "Mombasa Auto Parts Ltd" } });
  const open = cust ? await prisma.opsOrder.findFirst({ where: { customerId: cust.id, doneCount: { lt: 15 } }, orderBy: { createdAt: "asc" } }) : null;
  await prisma.$disconnect();
  if (!open) { console.error("No open order for Mombasa Auto Parts Ltd. Run: npx tsx scripts/seed.ts"); process.exit(1); }

  const emails = JSON.parse(readFileSync("test/fixtures/sample-emails.json", "utf8")) as Array<{ key: string; expect: string; from: string; subject: string; body: string }>;
  const run = Date.now();
  let bad = 0;
  for (const e of emails) {
    const sub = (s: string) => s.replaceAll("{{ORDER_ID}}", open.id);
    const t0 = Date.now();
    const res = await fetch(`${base}/api/intake/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-intake-secret": secret },
      body: JSON.stringify({ messageId: `e2e-${run}-${e.key}`, from: e.from, subject: sub(e.subject), body: sub(e.body), date: new Date().toISOString() }),
    });
    const out = (await res.json()) as { status?: string; routeReason?: string };
    const pass = res.ok && out.status === e.expect;
    if (!pass) bad++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${e.key.padEnd(16)} expected ${e.expect.padEnd(18)} got ${String(out.status).padEnd(18)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ${out.routeReason ?? ""}`);
  }
  console.log(bad ? `\n${bad} FAILED` : "\nAll 5 sample emails routed correctly.");
  process.exit(bad ? 1 : 0);
})();
