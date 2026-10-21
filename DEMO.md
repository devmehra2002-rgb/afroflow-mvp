# AfroFlow demo: "an email becomes an order, nobody types"

Live site: https://afrofloow.vercel.app   (sign in with a Google account on the allowlist)

## The cast
| Who | Address | Role in the demo |
|---|---|---|
| Sender A | dev_mehra@forge27.mesaschool.co | An existing customer: **Mombasa Auto Parts Ltd** (already has an earlier order, AA-2026-021, brake shoes) |
| Sender B | chipmonk.snacks@gmail.com | A company AfroFlow has never heard of |
| The inbox | devmehra2002@gmail.com | The intake inbox n8n watches |

## 2-minute demo script

**Setup (before you start talking):** AfroFlow open on **Inquiries** (empty board). Sender A's Gmail open, ready to send.

1. **The problem (20 sec).** "A buyer emails us. Today someone reads it, retypes it into a sheet, hunts for the customer, and sometimes forgets to reply. Watch what happens when nobody types."
2. **The magic moment (45 sec).** From Sender A, email the intake inbox:
   - Subject: `Brake shoes again`
   - Body: `2 x 40 ft, same brake shoes as last order, CIF Mombasa, by December.`

   Switch to AfroFlow. Within about a minute a card appears on its own (the page refreshes itself every 15 seconds) under **Existing customers**. Point out: customer matched by email, product, 2 x 40 ft, CIF, Mombasa, deadline filled in, a **reply-within-24h timer** running, and the deadline flagged "low confidence" because "by December" is a guess.
3. **AI reads, rules decide, humans approve (30 sec).** Open **Customers > Mombasa Auto Parts Ltd**: the same card sits in their folder. "Claude only *read* the email. A plain rule matched the sender to the customer. Nothing is an order yet."
4. **Human approves (25 sec).** Click **Convert to order**. The normal New Export Order form opens, already filled in. Say "A person checks it and clicks Create Order." Click it. The order appears with its 15-step plan, owners and due dates.

**If there is time (optional, 30 sec):** From Sender B send `hi, what is your price for the usual stuff?` and show it landing in **Needs review** with the reason "confidence below 0.7": the system does not guess.

## 11:30 AM checklist (run all of it)
- [ ] **Sign in** to https://afrofloow.vercel.app with the account you will present from. Inquiries page loads, no red "Can't reach the shared database" box.
- [ ] **Warm the database** (it sleeps when idle): click Inquiries, Export Orders, Customers once each.
- [ ] **Board is empty.** If it has cards: tell Claude "reset the demo".
- [ ] **n8n**: workflow "AfroFlow email intake" shows **Active** (toggle on). Gmail credential connected.
- [ ] **Send the rehearsal email** from Sender A (script above). A card appears in under ~90 seconds under Existing customers, product "brake shoes", 2 x 40 ft, Mombasa. Time it.
- [ ] **Open the card's "Original email"** and check it is readable.
- [ ] **Click Convert to order** and confirm the form is filled in. **Cancel** (do not create it; or create it and tell Claude to reset after).
- [ ] **Reset**: tell Claude "reset the demo" so the board is empty again for the real run.
- [ ] **Credits**: console.anthropic.com shows credit left (each email costs a fraction of a cent).
- [ ] **Wi-Fi/hotspot** tested. Second device logged in as a backup.
- [ ] **Screenshot** of a finished run saved, in case the network fails.

## If something breaks on stage
- *Card does not appear after 2 minutes:* in n8n click **Execute workflow** on the Gmail node to pull it now. Still nothing? Ask Claude to "inject the sample email": it posts straight to the endpoint (see below) and the card appears in seconds.
- *Card is in Needs review instead:* that is the system being careful, not broken. Open it, show the reason, Convert anyway.
- *Page shows a red database banner:* wait 10 seconds and reload (database waking up).
- *Total failure:* Claude can put the previous version of the site back in under a minute.

## For Claude / developers
- Intake endpoint: `POST /api/intake/email`, header `X-Intake-Secret`, body `{messageId, from, subject, body, date}`.
- All 5 sample emails end to end: `BASE_URL=https://afrofloow.vercel.app INTAKE_SECRET=... npx tsx scripts/e2e-sample-emails.ts`
- Seed demo customers + earlier order: `npx tsx scripts/seed.ts`
- Reset the board: `npx tsx scripts/reset-demo.ts`  (`CONFIRM=yes ... --hard` wipes orders and customers too: pre-demo only)
- Tests (fake AI, no API calls): `npx tsx test/intake.test.ts`
- Settings in one place: `src/lib/intake/constants.ts` (confidence threshold 0.7, reply window 24h). Prompt: `prompts/extract-enquiry.md` (v1.1).
- Previous live version (for rollback): `afrofloow-91v9b0419-devmehra2002-1720s-projects.vercel.app` (`vercel alias set <that url> afrofloow.vercel.app`).
