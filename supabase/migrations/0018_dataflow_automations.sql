-- =============================================================================
-- 0018 — DATA-FLOW AUTOMATIONS (close the audit's inventory/sales-truth silos)
--
--   reorder_suggestions  — Inventory → Procurement. Below-par materials with a
--                          suggested order qty, est cost (WAC), usual vendor and
--                          days-of-cover from recent SALES_DEPLETION velocity.
--   pos_revenue_expected — POS → Revenue. Expected gross per day
--                          (Σ pos_sales.quantity × recipe.selling_price) to
--                          cross-check the manager's hand-entered reconciliation.
--
-- security_invoker = on → both inherit the caller's RLS (location-scoped).
-- Idempotent (create or replace). Run after 0017.
-- =============================================================================

create or replace view public.reorder_suggestions with (security_invoker = on) as
with on_hand as (
  select location_id, raw_material_id, sum(current_stock) as current_stock
    from public.live_stock
   group by location_id, raw_material_id
),
velocity as (
  -- average daily consumption over the trailing 14 days
  select location_id, raw_material_id,
         coalesce(sum(quantity), 0) / 14.0 as daily_usage
    from public.inventory_ledger
   where type = 'SALES_DEPLETION'
     and created_at >= now() - interval '14 days'
   group by location_id, raw_material_id
)
select
  rm.location_id,
  rm.id   as raw_material_id,
  rm.name as raw_material_name,
  rm.stock_unit,
  rm.par_level,
  coalesce(oh.current_stock, 0)                                   as current_stock,
  greatest(rm.par_level - coalesce(oh.current_stock, 0), 0)       as suggested_qty,
  coalesce(wac.weighted_avg_cost, 0)                             as last_unit_cost,
  round(greatest(rm.par_level - coalesce(oh.current_stock, 0), 0)
        * coalesce(wac.weighted_avg_cost, 0), 2)                  as est_cost,
  rm.vendor_id,
  v.name  as vendor_name,
  coalesce(vel.daily_usage, 0)                                    as daily_usage,
  case when coalesce(vel.daily_usage, 0) > 0
       then round(coalesce(oh.current_stock, 0) / vel.daily_usage, 1)
       else null end                                              as days_cover
from public.raw_materials rm
left join on_hand  oh  on oh.raw_material_id  = rm.id and oh.location_id  = rm.location_id
left join velocity vel on vel.raw_material_id = rm.id and vel.location_id = rm.location_id
left join public.weighted_average_cost wac
       on wac.raw_material_id = rm.id and wac.location_id = rm.location_id
left join public.vendors v on v.id = rm.vendor_id and v.location_id = rm.location_id
where coalesce(oh.current_stock, 0) < rm.par_level;

create or replace view public.pos_revenue_expected with (security_invoker = on) as
select
  ps.location_id,
  (ps.sold_at at time zone 'Asia/Kolkata')::date as sale_date,
  sum(ps.quantity * r.selling_price)             as expected_gross,
  sum(ps.quantity)                               as items_sold
from public.pos_sales ps
join public.recipes r on r.id = ps.recipe_id and r.location_id = ps.location_id
group by ps.location_id, (ps.sold_at at time zone 'Asia/Kolkata')::date;

grant select on public.reorder_suggestions  to authenticated;
grant select on public.pos_revenue_expected to authenticated;

-- =============================================================================
-- END 0018
-- =============================================================================
