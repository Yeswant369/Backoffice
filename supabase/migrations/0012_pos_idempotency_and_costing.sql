-- =============================================================================
-- BOH ERP — Phase 6.1: POS webhook IDEMPOTENCY + COGS correctness/perf
--
-- Fixes from the adversarial review of the Phase 6 build:
--   * CRITICAL: the Petpooja webhook was non-idempotent — a retry (failed write
--     → 500, or a lost ACK) re-posted pos_sales / SALES_DEPLETION ledger /
--     unmapped_sales, double-counting sales volume and double-depleting stock.
--     We add per-order idempotency keys + unique constraints so the route can
--     upsert-ignore-duplicates and replays become no-ops.
--   * recipe_cogs() dropped each sub-recipe's overhead_percentage — now applied.
--   * recipe_costing called recipe_cogs() three times per row — now once.
--
-- Idempotent. Run AFTER 0010 + 0011.
-- =============================================================================

-- =============================================================================
-- SECTION 1: pos_sales idempotency — order_id + line_no, unique per location.
-- order_id is ALWAYS set by the route (the real POS order id, or a sha256 of the
-- raw payload when the POS omits one — identical retries hash identically).
-- =============================================================================
alter table public.pos_sales add column if not exists order_id text;
alter table public.pos_sales add column if not exists line_no  int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_pos_sales_order_line'
  ) then
    alter table public.pos_sales
      add constraint uq_pos_sales_order_line unique (location_id, order_id, line_no);
  end if;
end $$;

-- =============================================================================
-- SECTION 2: inventory_ledger idempotency for SALES_DEPLETION — source_ref.
-- A plain (non-partial) UNIQUE works because legacy/other-type rows leave
-- source_ref NULL, and NULLs are DISTINCT in a unique index — so the millions of
-- PURCHASE/ISSUE rows never collide, while two SALES_DEPLETION rows for the same
-- (location, order, raw_material) cannot both exist. ALTER is DDL → not blocked
-- by the prevent_mutation row trigger.
-- =============================================================================
alter table public.inventory_ledger add column if not exists source_ref text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_inventory_ledger_source_ref'
  ) then
    alter table public.inventory_ledger
      add constraint uq_inventory_ledger_source_ref
      unique (location_id, source_ref, raw_material_id);
  end if;
end $$;

-- =============================================================================
-- SECTION 3: unmapped_sales idempotency — order_id + line_no.
-- =============================================================================
alter table public.unmapped_sales add column if not exists order_id text;
alter table public.unmapped_sales add column if not exists line_no  int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_unmapped_sales_order_line'
  ) then
    alter table public.unmapped_sales
      add constraint uq_unmapped_sales_order_line unique (location_id, order_id, line_no);
  end if;
end $$;

-- =============================================================================
-- SECTION 4: recipe_cogs() — now compounds each SUB-RECIPE's overhead onto its
-- own materials as they roll up (previously only the top recipe's overhead was
-- applied). Still cycle-safe via the path[] guard. SECURITY INVOKER.
-- =============================================================================
create or replace function public.recipe_cogs(p_recipe_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with recursive exploded as (
    select
      ri.recipe_id,
      ri.raw_material_id,
      ri.sub_recipe_id,
      ri.quantity_needed,
      array[ri.recipe_id] as path,
      1::numeric          as multiplier
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id

    union all

    -- Descend into a sub-recipe: scale by the parent line qty, normalise by the
    -- child's yield_portions, AND apply the child's own overhead_percentage.
    select
      child.recipe_id,
      child.raw_material_id,
      child.sub_recipe_id,
      child.quantity_needed,
      e.path || child.recipe_id,
      e.multiplier
        * e.quantity_needed
        / greatest(coalesce(sub.yield_portions, 1), 1)
        * (1 + coalesce(sub.overhead_percentage, 0) / 100.0) as multiplier
    from exploded e
    join public.recipes sub               on sub.id = e.sub_recipe_id
    join public.recipe_ingredients child  on child.recipe_id = e.sub_recipe_id
    where e.sub_recipe_id is not null
      and not (child.recipe_id = any (e.path))
  ),
  batch as (
    select coalesce(sum(
             e.multiplier
             * e.quantity_needed
             * coalesce(wac.weighted_avg_cost, 0)
           ), 0) as batch_cost
    from exploded e
    join public.raw_materials rm
      on rm.id = e.raw_material_id
    left join public.weighted_average_cost wac
      on wac.raw_material_id = e.raw_material_id
     and wac.location_id     = rm.location_id
    where e.raw_material_id is not null
  )
  select round(
           (b.batch_cost / greatest(r.yield_portions, 1))
           * (1 + coalesce(r.overhead_percentage, 0) / 100.0),
           4
         )
  from public.recipes r
  cross join batch b
  where r.id = p_recipe_id;
$$;
grant execute on function public.recipe_cogs(uuid) to authenticated;

-- =============================================================================
-- SECTION 5: recipe_costing — call recipe_cogs() ONCE per row via LATERAL
-- (was invoked 3× per row → 3× the recursive explosion cost).
-- =============================================================================
drop view if exists public.recipe_costing;
create view public.recipe_costing with (security_invoker = on) as
select
  r.id            as recipe_id,
  r.location_id,
  r.name          as recipe_name,
  r.category,
  r.selling_price,
  c.cogs,
  (r.selling_price - c.cogs) as margin_value,
  case when r.selling_price > 0
       then round((r.selling_price - c.cogs) / r.selling_price * 100.0, 2)
       else 0 end as margin_pct,
  case when r.selling_price > 0
       then round(c.cogs / r.selling_price * 100.0, 2)
       else 0 end as food_cost_pct
from public.recipes r
cross join lateral (select public.recipe_cogs(r.id) as cogs) c;
grant select on public.recipe_costing to authenticated;

-- =============================================================================
-- END OF PHASE 6.1 MIGRATION
-- =============================================================================
