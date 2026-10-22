# AfroFlow: email enquiry to export order, nobody types

AfroFlow is an order-management tool for small export houses (10–30 containers a month). This repo is the **MVP of one journey**: a buyer emails the company, and a few seconds later the enquiry sits on a shared board, already read, matched to the right customer and time-stamped, waiting for a person to approve it.

> **AI reads, rules decide, humans approve.**
> Claude only *reads* the email. Plain, testable code decides where it goes. Nothing becomes an order until a person clicks **Convert to order**.

Live app: https://afrofloow.vercel.app (Google sign-in, restricted to an allowlist; see `DEMO.md` for a walkthrough).
Scope and research behind it: [`docs/MVP_SCOPE.md`](docs/MVP_SCOPE.md).

## The journey

```
Buyer's email ──► Gmail inbox ──► n8n (checks every minute)
                                      │  POST /api/intake/email   (secret header)
                                      ▼
                         Claude reads the email  ── is it a buyer enquiry?
                                      │             product, quantity, container,
                                      │             incoterm, port, deadline,
                                      │             confidence per field
                                      ▼
                       Rules decide (no AI, unit-tested)
                       ├─ sender matches no customer      → New Inquiry Board
                       ├─ sender matches a customer       → that customer's folder
                       ├─ mentions their open order no.   → that order's activity log
                       └─ low confidence / not a buyer    → Needs review
                                      ▼
                  Inquiry Board (shared Postgres, reply-within-24h timer)
                                      ▼
              [Convert to order] → existing New Export Order form, pre-filled
                                      ▼
                  A person checks it and clicks Create Order
```

## What is built (this MVP)

- **Email intake endpoint** protected by a shared-secret header, duplicate-safe (the same email twice is saved once).
- **Claude extraction** with a versioned prompt ([`prompts/extract-enquiry.md`](prompts/extract-enquiry.md)), a strict schema, one retry, and a graceful fallback to "Needs review" if the AI step fails. Email text is treated as untrusted data.
- **Routing rules** in [`src/lib/intake/rules.ts`](src/lib/intake/rules.ts). The confidence threshold (default 0.7) and reply window (24h) live in [`constants.ts`](src/lib/intake/constants.ts).
- **"Same brake shoes as last order"**: if the AI can't name the product, a rule copies it from that customer's latest order and marks it *inferred*.
- **New Inquiry Board**, customer folders, order activity log, low-confidence fields flagged, live reply timer, auto-refresh.
- **Shared database** (Neon Postgres): orders, customers, inquiries now live there instead of each person's browser. One-time import of old browser data included.
- **n8n workflow**: [`n8n/afroflow-email-intake.json`](n8n/afroflow-email-intake.json) (Gmail Trigger → HTTP Request).
- **Google sign-in** with an email allowlist in front of everything except the intake endpoint.

Built earlier and kept: the 15-step order plan with owners, due dates and health score; tasks; container-based quantities; inquiry date; document slots linked to tasks; vessel tracking. An AI document scanner also exists in the code but is switched off (`SCANNER_ENABLED` in `public/afroflow.html`); it is a later release.

## Not built yet (on purpose)

WhatsApp intake (needs Meta Business API approval), auto-reply, draft replies, supplier POs and fill rate, document generation, CHA/bank message reading, e-BRC and incentive tracking, daily digest, buyer status link. See the scope doc.

## Stack

Next.js 16 · Auth.js (Google) · Prisma 6 + Postgres (Neon) · Anthropic Claude API · n8n · Vercel.
The main UI is a single static page, `public/afroflow.html`, served behind the login gate.

## Run it yourself

```bash
npm install
cp .env.example .env.local     # fill in the values
psql "$DATABASE_URL" -f prisma/sql/001_mvp_tables.sql   # creates the MVP tables (additive)
npx prisma generate
npx tsx scripts/seed.ts        # 3 demo customers + one earlier order
npm run dev                    # http://localhost:3002
```

Environment variables are listed in [`.env.example`](.env.example). **No secrets are committed.**

## Tests

```bash
npx tsx test/intake.test.ts     # 45 checks: routing rules, sender parsing, Gmail format, schema, secret check
npx tsx test/scanner.test.ts    # document scanner comparison logic
npx tsx test/extract.test.ts
npx tsx test/draft.test.ts      # step 3: reply drafter (12 checks)
node test-logic.mjs             # order features
```

The AI is **mocked** in every test: no network, no API key needed.
End to end against a deployed copy (sends the 5 sample emails the way n8n does):

```bash
BASE_URL=https://your-deployment INTAKE_SECRET=... npx tsx scripts/e2e-sample-emails.ts
```

Result on the live site: all 5 sample emails routed correctly (existing customer, new customer, not-a-buyer, vague, order follow-up).

## Folder map

| Path | What |
|---|---|
| `public/afroflow.html` | The app UI (orders, tasks, Inquiry Board, customer folders) |
| `src/app/api/intake/email/` | The email intake endpoint |
| `src/lib/intake/` | Extraction (Claude), routing rules, settings |
| `prompts/` | Versioned AI prompt |
| `prisma/` | Schema + additive SQL for the MVP tables |
| `n8n/` | Importable n8n workflow |
| `scripts/` | Seed, reset, end-to-end test |
| `test/` | Automated tests and sample emails/documents |
| `docs/MVP_SCOPE.md` | Problem, evidence, solution, scope |
| `DEMO.md` | 2-minute demo script and checklist |

## Step 3: draft reply and reply reminder

On every open buyer enquiry, **Draft reply with AI** asks Claude for a short first reply (it sees the email and that customer's past orders, and is told never to state prices or promise anything). You edit it, then **Save to Gmail drafts**. A second n8n workflow (`n8n/afroflow-draft-and-reminders.json`) creates the Gmail draft. **Nothing is ever sent automatically**: you press Send in Gmail. The same workflow emails you a nudge when an enquiry has under 4 hours left on its 24h reply timer; **I've replied** stops the nudges.
