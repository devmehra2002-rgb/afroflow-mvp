AfroFlow: MVP Scope
Dev Mehra · 21 October 2026
Problem statement: Export house owners shipping 10 to 30 containers a month, and their small ops teams, spend about 22 hours a week (estimate, to validate) chasing order status, reconciling partial supply and preparing and checking documents across WhatsApp, email and Excel, because they can't see which order is stuck between procurement, cargo, documents and bank until a buyer complains or a deadline is missed.
Evidence caveat: no source in the research is an export house owner at this volume, and none mentions WhatsApp. The voices below are logistics staff, forwarders and importers. Anything marked GAP needs customer interviews.
1. Problem
Who: export house owners and their 1 to 3 person ops team (sales, procurement, documentation, finance).
"I've seen teams lose hours every week fixing basic paperwork, invoice mismatches, missing data, incorrect BOLs." (r/logistics)
"I can't see the details of every shipment I have, which is frustrating." (G2, Magaya user managing import and export documents)
An importer whose supplier keeps sending faulty shipping documents now ends up "double checking every document." (r/supplychain)
GAP: a quote from an export house owner at 10 to 30 containers a month.
2. Current State
One-time setup: IEC, AD code, RCMC, GST LUT.
Enquiry by WhatsApp or email; customer ID and order number assigned by hand. Quotes built manually (G2).
Proforma invoice: product, quantity, USD rate, exchange rate.
Buyer confirms: buyer PO or signed PI, then advance or LC.
Supplier POs: one per supplier, usually 4 to 5 per order.
Supply and QC: supply is never 100%, so each delivery is checked against its PO in Excel. Supplier paperwork often has errors (r/supplychain).
Export documents: commercial invoice, packing list, COO, e-way bill. Often one person does all documentation on slow tools (r/logistics).
Booking and shipping bill: shipping line or forwarder books the container; CHA files the shipping bill. Data is typed into several systems (G2).
Stuffing, examination, LEO, then the container leaves for port.
Bill of lading issued after loading.
Payment: advance, or documents through the bank. Payment entries are keyed in by hand (G2).
Close: e-BRC, duty drawback, RoDTEP.
Across every step: status is chased by WhatsApp, calls and email, and tracked in sheets (GAP: not described in the research).
Tools used: WhatsApp, Gmail, Excel, ICEGATE, CHA and shipping line portals. Paid alternatives: Magaya, Inttra, Zoho, Expodite, Shipzy.
AfroFlow today: order plan, tasks, owners, health score, document upload slots and vessel tracking, all entered by hand and stored only in the browser.
3. Opportunity
Metric
Evidence
Source
Frequency
Paperwork fixed every week
r/logistics
Time chasing status
No measured figure
GAP
Nearest time figure
10 to 15 hrs/week, but for competitor customs research
r/logistics
Cost of delay
$1,500/day delay fees (US)
G2
Willingness to pay
$10K/quarter on Magaya; $300 to $450 per extra seat
G2, G2
Market
India exports $860.09B in FY 2025 to 26
The Dollar Business
Small exporter share
45% to 50% of exports from small industry, about 35% direct
DC-MSME
Policy tailwind
Registration waived for small shipments up to ₹3,00,000
Reuters
Export houses at 10 to 30 containers/month
No figure
GAP
4. Solution
AfroFlow already plans every order. The new layer captures what actually happens, creates documents, scans them for errors and chases what is late.
#
Future step
What disappears
1
Enquiry captured from email or WhatsApp, matched to customer, routed to New Inquiry Board or customer folder
Manual "New Export Order" form
2
Order created with 15-step plan, owners, due dates (already built)
3
Draft reply with last prices; reply reminder
Forgotten enquiries
4
PI drafted from agreed terms; owner approves
Retyping terms
5
Buyer PO, advance or LC matched; procurement unlocks
Checking inboxes
6
One PO per supplier generated and sent
Typing each PO
7
Supplier challans read; fill rate per supplier; shortfall options
Excel reconciliation
8
Invoice and packing list generated from received supply
Drafting from scratch
9
AI scanner checks invoice, packing list, PO, PI and LC
Line-by-line checking
10
CHA messages read: container, shipping bill, LEO, cutoff
Double entry
11
AI scanner checks draft BL against invoice, packing list and shipping bill
Manual BL check
12
Bank advice read; payment marked; realised FX shown
Manual payment entry
13
e-BRC, drawback and RoDTEP tracked
Incentive sheet
Daily
Stuck-orders digest on WhatsApp; buyer status link
Chasing status
Always
Owner approves PIs, POs, documents and BL; decides shortfalls
Stays human
5. AI Thinking
AI reads, rules decide, humans approve.
AI: reading enquiries, buyer POs, supplier challans, CHA updates and bank advices (every sender writes differently, often as photos or voice notes); extracting fields for the scanner; judging near-matches ("brake shoe, motorcycle" vs "two wheeler brake shoes"); drafting replies, PIs and summaries.
Rules: customer lookup by phone or email, due dates, fill rate maths, exact field comparison, amount matching, stuck thresholds ("no update in 3 days"), e-BRC and incentive deadlines. These need to be exact and predictable, so AI would add risk, not value.
Human: approving PIs, POs, documents and the BL; shortfall decisions; buyer calls. These involve money, legal documents or relationships.
6. Architecture
Input
AI / model
Logic
Action / tools
Output
Gmail emails; WhatsApp Business Cloud API; uploaded documents; Excel import
Claude API: classify, extract fields, read PDFs and photos, scan documents, draft replies
n8n plus rules in GitHub: matching, stage and stuck rules, exact compare, approval gates
n8n: create or update order, update fill rate, generate documents, send alerts, draft replies
AfroFlow on Vercel: New Inquiry Board, order folders, scanner reports; daily WhatsApp digest; buyer status link

Constraint: n8n can only read WhatsApp messages sent to a WhatsApp Business Cloud API number, not personal chats or existing groups. AfroFlow also needs a shared database, since today all orders and uploads live in each browser's local storage.
7. Impact
Assumptions (to validate): 20 shipments a month, so 4.6 a week; 30 open orders; 4.5 suppliers per order, so 20.7 POs a week; 2 deliveries per PO, so 41 a week; 15 enquiries a week.
Task
Time today per week
Removed
Saved per week
Logging enquiries
15 × 5 min = 1.3 hrs
80%
1.0 hrs
Chasing status
30 × 10 min = 5.0 hrs
80%
4.0 hrs
Writing supplier POs
20.7 × 10 min = 3.5 hrs
70%
2.4 hrs
Reconciling supply
41 × 5 min = 3.4 hrs
70%
2.4 hrs
Preparing invoice and packing list
4.6 × 60 min = 4.6 hrs
70%
3.2 hrs
Checking documents
4.6 × 45 min = 3.5 hrs
60%
2.1 hrs
Payment entry
4.6 × 15 min = 1.2 hrs
70%
0.8 hrs
Total
22.5 hrs
15.9 hrs

Per user: the owner saves about 5 hrs a week; the documentation and procurement person saves about 11 hrs a week.
Quality: document errors are caught before they reach the CHA or bank. One avoided delay day saves about $1,500 (G2, US figure; Indian port charges are a GAP).
Scale: the same team handles more open orders without hiring.
8. Limitations
Failure
What happens
What a human checks
Scanner says documents match when they don't
A blurry scan or near-identical description passes; bank or customs rejects the set
Owner reviews every scanner report; low-confidence fields highlighted; nothing auto-submitted
Message lands on the wrong order or customer
Similar buyer names or a vague "brake shoe order" attaches wrongly
Low-confidence matches go to "needs review," confirmed in one tap
Silence looks like progress
Supplier goes quiet or CHA updates by phone
"No update in 3 days" flags it in the daily digest; owner calls

Build next: AI document scanner, then supplier POs with partial supply and fill rate, then WhatsApp intake.
9. MVP Scope
IN: build by Thu 12:30 PM
One journey: from a buyer's enquiry email to an order on AfroFlow, with zero typing.
Email intake: n8n watches a dedicated Gmail inbox. Claude filters out non-buyer messages and extracts customer, product, quantity, port and deadline.
Match and route: the sender's email is matched to a known customer. New customer goes to the New Inquiry Board, existing customer to their folder, a follow-up to that order's activity log, and anything uncertain to "needs review."
New Inquiry Board on a shared database: each card shows the extracted details and a reply-by timer. "Convert to order" pre-fills the existing New Export Order form. Orders move from browser storage to Postgres so the whole team sees the same board.
OUT: mention, don't build
WhatsApp intake (needs Meta approval for the Business API), auto-reply asking for IDs, dedupe across email and WhatsApp, voice notes and Hindi messages, daily digest.
LATER: v2
AI document scanner (first), supplier POs with partial supply and fill rate, invoice and packing list generation, CHA and BL reading, bank advice matching, e-BRC and incentive tracking, buyer status link, real health scores and analytics, "where is order 112?" on WhatsApp.
Magic moment
You forward a buyer's email ("2 x 40 ft, same brake shoes as last order, CIF Mombasa, by December"). Within a minute it appears in that customer's folder in AfroFlow with product, quantity, port and deadline filled in and a reply-by timer running. Nobody typed anything.
Tech stack
Tool
What it does
Claude
Classifies each email and extracts the fields as structured data with a confidence score
n8n
Gmail trigger, then Claude, then matching rules, then writes to the database
GitHub
AfroFlow code, matching rules, Claude prompts and the exported n8n workflow, all versioned
Vercel
Hosts AfroFlow with the New Inquiry Board; Postgres from the Vercel Marketplace replaces browser storage

Build order for the next 20 hours: database and board tonight; n8n and Claude intake tomorrow morning; seed 3 test customers and 5 sample emails; demo rehearsal by 11:30 AM.
Sources
Apify datasets used
Dataset
Actor
Content
ZDfRk6rQqoEcbt9bW
trudax/reddit-scraper-lite
r/logistics, 14 items
rREw6J0TiQ0iNduGT
trudax/reddit-scraper-lite
r/supplychain, 13 items
JnsiCpQOhLsN38eME
trudax/reddit-scraper-lite
r/IndiaBusiness, 13 items
OHyD0aHR67EtwUpeW
apify/google-search-scraper
3 queries, 27 organic results
3GjWEe6XeM17E46iO
automation-lab/g2-scraper
Magaya Supply Chain, 20 lowest-rated reviews
VOUqkIachV6f1ZiNe
automation-lab/g2-scraper
Expodite and Shipzy, 2 reviews
Links cited
r/logistics: documentation errors and comment
r/logistics: hours on customs data
r/supplychain: bad supplier documents and comment
G2 Magaya reviews: 12551344, 11458220, 8486914, 10438136, 11890597, 10471236
G2 Expodite review
The Dollar Business: India export data 2026
DC-MSME: small industry share of exports
Reuters: export rules eased for small exporters

