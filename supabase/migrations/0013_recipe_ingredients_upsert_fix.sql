-- =============================================================================
-- BOH ERP — Phase 6.2: restore recipe_ingredients UPSERT arbiter.
--
-- 0010 replaced the original `unique (recipe_id, raw_material_id)` with a PARTIAL
-- unique index (... where raw_material_id is not null). A partial index cannot
-- serve as an ON CONFLICT arbiter unless the predicate is restated, which the
-- supabase-js client can't express — so the recipe "Pull from Sheet" upsert
-- (onConflict: "recipe_id,raw_material_id") errors 42P10.
--
-- Fix: use a NON-partial unique constraint instead. Because NULLs are DISTINCT in
-- a unique constraint, sub-recipe lines (raw_material_id IS NULL) never collide,
-- so multiple sub-recipe rows per recipe are still allowed — sub-recipe dedup
-- stays enforced by uq_recipe_ingredients_subrecipe (kept). Raw-material lines
-- get one-per-(recipe,material) AND a valid ON CONFLICT target.
--
-- Idempotent. Run AFTER 0010.
-- =============================================================================

-- Drop the partial raw-material unique index from 0010.
drop index if exists public.uq_recipe_ingredients_material;

-- Add a plain (non-partial) unique constraint usable by ON CONFLICT.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recipe_ingredients_recipe_material_key'
  ) then
    alter table public.recipe_ingredients
      add constraint recipe_ingredients_recipe_material_key
      unique (recipe_id, raw_material_id);
  end if;
end $$;

-- uq_recipe_ingredients_subrecipe (partial, sub-recipe dedup) is intentionally
-- left in place from 0010.

-- =============================================================================
-- END OF PHASE 6.2 MIGRATION
-- =============================================================================
