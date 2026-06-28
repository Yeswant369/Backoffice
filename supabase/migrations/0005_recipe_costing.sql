-- =============================================================================
-- Phase: Recipe costing & Google Sheets sync
-- Adds culinary/costing fields to recipes:
--   yield_portions       — plates a multi-portion batch yields
--   overhead_percentage  — operational markup (e.g. 25)
--   category             — cuisine, maps to a Google Sheet tab (South Indian…)
-- =============================================================================

alter table public.recipes
  add column if not exists yield_portions int not null default 1
    check (yield_portions > 0);

alter table public.recipes
  add column if not exists overhead_percentage numeric(6,2) not null default 0
    check (overhead_percentage >= 0);

alter table public.recipes
  add column if not exists category varchar(100);
