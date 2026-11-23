-- Lead quality check: one row per check of a sender. Additive only.
CREATE TABLE IF NOT EXISTS "LeadCheck" (
  "id"           TEXT PRIMARY KEY,
  "inquiryId"    TEXT NOT NULL REFERENCES "Inquiry"("id") ON DELETE CASCADE,
  "domain"       TEXT NOT NULL,
  "score"        INTEGER NOT NULL,
  "tier"         TEXT NOT NULL,
  "facts"        JSONB NOT NULL,
  "research"     JSONB,
  "reasons"      JSONB NOT NULL,
  "scoreVersion" TEXT NOT NULL,
  "promptVersion" TEXT,
  "model"        TEXT,
  "searches"     INTEGER NOT NULL DEFAULT 0,
  "overrideTier" TEXT,
  "overrideNote" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "LeadCheck_inquiryId_idx" ON "LeadCheck"("inquiryId");
CREATE INDEX IF NOT EXISTS "LeadCheck_domain_idx" ON "LeadCheck"("domain");
