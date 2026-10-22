-- Voice-call trial (local only): one row per AI call to a new customer. Additive only.
CREATE TABLE IF NOT EXISTS "CallAttempt" (
  "id"            text PRIMARY KEY,
  "inquiryId"     text NOT NULL REFERENCES "Inquiry"("id") ON DELETE CASCADE,
  "provider"      text NOT NULL DEFAULT 'bolna',
  "executionId"   text,
  "toPhone"       text NOT NULL,
  "status"        text NOT NULL DEFAULT 'CALLING',
  "providerStatus" text,
  "transcript"    text,
  "durationSec"   integer,
  "extracted"     jsonb,
  "extractionError" text,
  "applied"       jsonb,
  "appliedBy"     text,
  "appliedAt"     timestamp(3),
  "errorMessage"  text,
  "requestedBy"   text NOT NULL,
  "createdAt"     timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"     timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "CallAttempt_inquiryId_idx" ON "CallAttempt"("inquiryId");
