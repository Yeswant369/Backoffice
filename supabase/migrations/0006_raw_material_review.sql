-- =============================================================================
-- Sync engine: flag auto-created raw material stubs for review.
-- Pull's "Auto-create missing materials" inserts stubs (stock_unit='unit',
-- conversion_factor=1, no purchases ⇒ weighted-avg cost 0) with needs_review=true
-- so the Kitchen Manager can complete them.
-- =============================================================================

alter table public.raw_materials
  add column if not exists needs_review boolean not null default false;
