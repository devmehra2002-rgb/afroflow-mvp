-- WhatsApp owner assistant. Additive only.
-- Every message in or out (also used to ignore repeats and to know if the 24h window is open).
CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
  "id"        TEXT PRIMARY KEY,           -- Meta's message id (wamid) for inbound; generated for outbound
  "direction" TEXT NOT NULL,              -- IN | OUT
  "waId"      TEXT NOT NULL,              -- the other person's number (digits only)
  "kind"      TEXT NOT NULL DEFAULT 'text',
  "body"      TEXT,
  "intent"    TEXT,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_waId_dir_idx" ON "WhatsAppMessage"("waId", "direction", "createdAt");

-- Things to tell the owner. A sender applies quiet hours and the 24h rule, drops duplicates, then sends.
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"         TEXT PRIMARY KEY,
  "kind"       TEXT NOT NULL,             -- NEW_ENQUIRY | LEAD_CHECK | REPLY_DUE | APPROVAL | ORDER_DELAY | DAILY_SUMMARY
  "dedupeKey"  TEXT NOT NULL UNIQUE,
  "text"       TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SENT | EXPIRED | FAILED
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "lastError"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"     TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "Notification_status_idx" ON "Notification"("status", "createdAt");

-- A decision the owner is asked to make. Bound to the version that was shown, so an old "approve" cannot apply to changed numbers.
CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
  "id"          TEXT PRIMARY KEY,
  "kind"        TEXT NOT NULL,            -- PROFORMA
  "refId"       TEXT NOT NULL,            -- order id
  "versionHash" TEXT NOT NULL,
  "code"        TEXT NOT NULL,            -- 4 digits the owner must type to approve
  "status"      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | DENIED | HELD | STALE
  "summary"     TEXT NOT NULL,
  "decidedAt"   TIMESTAMP(3),
  "decidedVia"  TEXT,
  "decisionText" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_idx" ON "ApprovalRequest"("status", "createdAt");
