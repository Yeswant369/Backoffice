-- =============================================================================
-- Add a business/invoice DATE to the ledger, distinct from created_at.
--
-- Managers often log a purchase invoice days after it happened. created_at must
-- stay = the actual insertion time (it's the stable sort key the Purchase Log
-- sheet sync uses for append-by-count), so we record the user-selected invoice
-- date separately in transaction_date. The Purchase Log "Date" column and the
-- monthly Procurement Summary read transaction_date, falling back to created_at
-- for older rows (which stay NULL — UPDATE is blocked by prevent_mutation, so we
-- cannot backfill, and the COALESCE fallback handles it cleanly).
--
-- ALTER is DDL → not intercepted by the append-only prevent_mutation trigger.
-- Idempotent.
-- =============================================================================
alter table public.inventory_ledger
  add column if not exists transaction_date date;
