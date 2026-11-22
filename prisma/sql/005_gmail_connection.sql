-- Direct Gmail connection (replaces n8n). One row: the owner's mailbox.
-- Additive only. Run with: npx prisma db execute --file prisma/sql/005_gmail_connection.sql
CREATE TABLE IF NOT EXISTS "GmailConnection" (
  "id"             TEXT PRIMARY KEY DEFAULT 'owner',
  "email"          TEXT NOT NULL,
  "refreshTokenEnc" TEXT NOT NULL,
  "historyId"      TEXT,
  "watchExpiresAt" TIMESTAMP(3),
  "lastSyncAt"     TIMESTAMP(3),
  "lastError"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
