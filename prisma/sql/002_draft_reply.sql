-- Step 3: draft reply + reply reminder. Additive only.
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "draftBody" text;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "draftSubject" text;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "draftStatus" text NOT NULL DEFAULT 'NONE';
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "draftModel" text;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "gmailDraftId" text;
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "repliedAt" timestamp(3);
ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "reminderSentAt" timestamp(3);
