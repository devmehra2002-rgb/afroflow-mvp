-- Step 4: proforma invoice. Additive only.
CREATE TABLE IF NOT EXISTS "OrderProforma" (
  "orderId"    text PRIMARY KEY REFERENCES "OpsOrder"("id") ON DELETE CASCADE,
  "number"     text NOT NULL,
  "version"    integer NOT NULL DEFAULT 1,
  "status"     text NOT NULL DEFAULT 'DRAFT',
  "data"       jsonb NOT NULL DEFAULT '{}',
  "approvedBy" text,
  "approvedAt" timestamp(3),
  "createdAt"  timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt"  timestamp(3) NOT NULL DEFAULT now()
);
