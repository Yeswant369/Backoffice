-- =============================================================================
-- Phase 4: Enable Realtime on inventory_ledger
-- Supabase streams Postgres changes only for tables in the `supabase_realtime`
-- publication. The Store dashboard subscribes to inventory_ledger inserts so the
-- Live Stock table updates instantly. RLS still governs which rows a client
-- receives (authenticated users can SELECT the ledger per Phase 1 policies).
-- =============================================================================

alter publication supabase_realtime add table public.inventory_ledger;

-- Optional: uncomment to also stream vendor payment activity.
-- alter publication supabase_realtime add table public.vendor_payments;
