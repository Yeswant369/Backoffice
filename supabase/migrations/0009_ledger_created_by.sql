-- =============================================================================
-- Capture who created each ledger movement (drives the "Issued By" column in
-- the dynamic Issues - [Department] sheet tabs). Nullable; older rows stay null.
-- ALTER is DDL — not blocked by the append-only prevent_mutation trigger.
-- =============================================================================

alter table public.inventory_ledger
  add column if not exists created_by uuid references public.profiles (id) on delete set null;
