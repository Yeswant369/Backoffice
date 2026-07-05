-- =============================================================================
-- 0029 — save_recipe(): ATOMIC recipe create/update
--
-- Replaces the app-side header-update → delete-ingredients → re-insert sequence,
-- which had three integrity holes (review wf_a948f9e3):
--   1. Non-atomic: a failed re-insert could leave a recipe with ZERO ingredients
--      (restore best-effort), and the header update was never rolled back.
--   2. Transient-empty window: between delete and insert, a POS sale exploding
--      the recipe depleted NOTHING — writing immutable, wrong ledger rows.
--   3. Cycle TOCTOU: two concurrent edits could each add half of an A↔B cycle;
--      committed cycles silently TRUNCATE recipe_cogs (undercosted COGS) and
--      push every POS sale of the dish to unmapped_sales.
--
-- One transaction fixes all three: header + ingredient replacement + cycle
-- check commit or roll back together; a per-location advisory lock serializes
-- recipe-graph writers; the cycle walk runs AFTER the insert, under the lock.
--
-- SECURITY INVOKER: every statement runs under the caller's RLS (home write).
--
-- Idempotent. Run after 0028.
-- =============================================================================

create or replace function public.save_recipe(
  p_recipe_id   uuid,     -- null → create
  p_fields      jsonb,    -- {name, selling_price, yield_portions, overhead_percentage,
                          --  category, course, video_url, pos_item_code, department_id}
  p_ingredients jsonb     -- [{raw_material_id|sub_recipe_id, quantity_needed, notes}]
) returns uuid
language plpgsql as $$
declare
  v_home  uuid := public.current_location_id();
  v_id    uuid := p_recipe_id;
  v_cycle boolean;
begin
  if v_home is null then
    raise exception 'NO_HOME: account has no home location';
  end if;

  -- Serialize recipe-graph writers per location (kills the cycle TOCTOU race).
  perform pg_advisory_xact_lock(hashtext('recipe_graph:' || v_home::text));

  if v_id is null then
    insert into public.recipes
      (name, selling_price, yield_portions, overhead_percentage,
       category, course, video_url, pos_item_code, department_id, location_id)
    values
      (p_fields->>'name',
       (p_fields->>'selling_price')::numeric,
       (p_fields->>'yield_portions')::int,
       (p_fields->>'overhead_percentage')::numeric,
       nullif(p_fields->>'category', ''),
       nullif(p_fields->>'course', ''),
       nullif(p_fields->>'video_url', ''),
       nullif(p_fields->>'pos_item_code', ''),
       nullif(p_fields->>'department_id', '')::int,
       v_home)
    returning id into v_id;
  else
    update public.recipes set
      name                = p_fields->>'name',
      selling_price       = (p_fields->>'selling_price')::numeric,
      yield_portions      = (p_fields->>'yield_portions')::int,
      overhead_percentage = (p_fields->>'overhead_percentage')::numeric,
      category            = nullif(p_fields->>'category', ''),
      course              = nullif(p_fields->>'course', ''),
      video_url           = nullif(p_fields->>'video_url', ''),
      pos_item_code       = nullif(p_fields->>'pos_item_code', ''),
      department_id       = nullif(p_fields->>'department_id', '')::int
    where id = v_id and location_id = v_home;
    if not found then
      raise exception 'NOT_FOUND: recipe not in your location';
    end if;
    delete from public.recipe_ingredients where recipe_id = v_id;
  end if;

  insert into public.recipe_ingredients
    (recipe_id, raw_material_id, sub_recipe_id, quantity_needed, notes, location_id)
  select
    v_id,
    nullif(e->>'raw_material_id', '')::uuid,
    nullif(e->>'sub_recipe_id', '')::uuid,
    (e->>'quantity_needed')::numeric,
    nullif(e->>'notes', ''),
    v_home
  from jsonb_array_elements(p_ingredients) e;

  if not exists (select 1 from public.recipe_ingredients where recipe_id = v_id) then
    raise exception 'NO_INGREDIENTS: a recipe needs at least one ingredient';
  end if;

  -- Authoritative cycle check, post-insert, under the lock. `union` (set
  -- semantics) terminates even when a cycle exists.
  with recursive walk(node) as (
    select ri.sub_recipe_id from public.recipe_ingredients ri
     where ri.recipe_id = v_id and ri.sub_recipe_id is not null
    union
    select ri.sub_recipe_id from public.recipe_ingredients ri
      join walk w on ri.recipe_id = w.node
     where ri.sub_recipe_id is not null
  )
  select exists (select 1 from walk where node = v_id) into v_cycle;
  if v_cycle then
    raise exception 'CYCLE: a sub-recipe (directly or indirectly) contains this recipe';
  end if;

  return v_id;
end $$;

revoke all on function public.save_recipe(uuid, jsonb, jsonb) from public;
grant execute on function public.save_recipe(uuid, jsonb, jsonb) to authenticated;

-- =============================================================================
-- END 0029
-- =============================================================================
