-- =============================================================================
-- 0028 — Phase C: Recipe Builder v2 schema
--
-- A. recipes.course     — service course (Starter / Main / Dessert / …) for
--                         menu sorting, alongside category (= cuisine).
-- B. recipes.video_url  — technique video / attachment link for the recipe.
-- C. recipe_ingredients.notes — per-ingredient technique note ("blanch first",
--                         "room temperature", …) stored with the line.
--
-- Idempotent. Run after 0027.
-- =============================================================================

alter table public.recipes add column if not exists course varchar(60);
alter table public.recipes add column if not exists video_url text;
alter table public.recipe_ingredients add column if not exists notes varchar(500);

-- =============================================================================
-- END 0028
-- =============================================================================
