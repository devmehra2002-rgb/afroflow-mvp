-- MVP email-intake tables. Additive only: nothing existing is altered or dropped.
CREATE TABLE IF NOT EXISTS "OpsCustomer" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "country" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpsCustomer_name_lower_key" ON "OpsCustomer" (lower("name"));

CREATE TABLE IF NOT EXISTS "OpsCustomerEmail" (
  "email" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "OpsCustomer"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "OpsCustomerEmail_customerId_idx" ON "OpsCustomerEmail" ("customerId");

CREATE SEQUENCE IF NOT EXISTS "OpsOrderSeq" START 21;

CREATE TABLE IF NOT EXISTS "OpsOrder" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT REFERENCES "OpsCustomer"("id") ON DELETE SET NULL,
  "customerName" TEXT NOT NULL,
  "country" TEXT,
  "product" TEXT NOT NULL,
  "qty" TEXT,
  "containerType" TEXT,
  "containerCount" INTEGER,
  "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "terms" TEXT,
  "shipDate" DATE NOT NULL,
  "inquiryDate" DATE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "doneCount" INTEGER NOT NULL DEFAULT 1,
  "docSteps" INTEGER[] NOT NULL DEFAULT '{}',
  "data" JSONB NOT NULL DEFAULT '{}',
  "sourceInquiryId" TEXT
);
CREATE INDEX IF NOT EXISTS "OpsOrder_customerId_idx" ON "OpsOrder" ("customerId");

CREATE TABLE IF NOT EXISTS "Inquiry" (
  "id" TEXT PRIMARY KEY,
  "gmailMessageId" TEXT NOT NULL UNIQUE,
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "subject" TEXT,
  "bodyText" TEXT,
  "receivedAt" TIMESTAMPTZ NOT NULL,
  "replyByAt" TIMESTAMPTZ NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "routeReason" TEXT,
  "customerId" TEXT REFERENCES "OpsCustomer"("id") ON DELETE SET NULL,
  "orderId" TEXT REFERENCES "OpsOrder"("id") ON DELETE SET NULL,
  "isBuyerEnquiry" BOOLEAN,
  "overallConfidence" DOUBLE PRECISION,
  "extracted" JSONB,
  "promptVersion" TEXT,
  "model" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Inquiry_status_idx" ON "Inquiry" ("status");
CREATE INDEX IF NOT EXISTS "Inquiry_customerId_idx" ON "Inquiry" ("customerId");

CREATE TABLE IF NOT EXISTS "OrderActivity" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "OpsOrder"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "inquiryId" TEXT REFERENCES "Inquiry"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "OrderActivity_orderId_idx" ON "OrderActivity" ("orderId");
