-- Step 4b: invoice numbers run in one series (PI/2026-27/1, PI/2026-27/2, ...), not per order.
CREATE SEQUENCE IF NOT EXISTS "ProformaSeq" START 1;
