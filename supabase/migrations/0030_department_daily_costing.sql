-- =============================================================================
-- 0030 — Phase D: Department daily stock ledger + food costing (consumption model)
--
-- The restaurant-standard flow the user asked for:
--   opening + issues − closing = consumption;  food cost % = consumption / sales
--
-- Everything is DERIVED from the immutable ledger — no new manual entries:
--   * opening(day)  = cumulative department balance before the day. Because a
--     stock count posts VARIANCE_RECONCILIATION that snaps system to actual,
--     yesterday's counted closing automatically BECOMES today's opening; on
--     uncounted days the system balance simply carries forward (D5 for free).
--   * closing(day)  = balance at end of day (= the count, on counted days).
--   * consumption   = opening + received − transferred out − closing
--                   ≡ sales depletion + wastage + shrinkage (identity holds
--     row-by-row in the ledger, so the two derivations always agree).
--   * "Daily closing entry" = the EXISTING stock-count flow for that department.
--
-- All values priced at current weighted-average cost (system-wide WAC note).
-- Business day = transaction_date, falling back to created_at (IST).
--
-- Idempotent. Run after 0029.
-- =============================================================================

create or replace view public.department_daily_stock with (security_invoker = on) as
with mv as (
  -- signed movements per department/material/business-day
  select location_id,
         coalesce(transaction_date, (created_at at time zone 'Asia/Kolkata')::date) as day,
         to_department_id as department_id, raw_material_id, type, quantity as qty
    from public.inventory_ledger
   where to_department_id is not null
  union all
  select location_id,
         coalesce(transaction_date, (created_at at time zone 'Asia/Kolkata')::date),
         from_department_id, raw_material_id, type, -quantity
    from public.inventory_ledger
   where from_department_id is not null
),
agg as (
  select location_id, department_id, raw_material_id, day,
         sum(qty) as net_qty,
         sum(case when qty > 0 and type in ('ISSUE_TO_KITCHEN','INTER_DEPARTMENT_TRANSFER')
                  then qty else 0 end) as issued_in_qty,
         sum(case when qty > 0 and type = 'PURCHASE' then qty else 0 end) as purchased_qty,
         sum(case when qty < 0 and type in ('ISSUE_TO_KITCHEN','INTER_DEPARTMENT_TRANSFER')
                  then -qty else 0 end) as transferred_out_qty,
         sum(case when qty < 0 and type in ('SALES_DEPLETION','MANUAL_SALE')
                  then -qty else 0 end) as sold_qty,
         sum(case when qty < 0 and type = 'WASTAGE' then -qty else 0 end) as wasted_qty,
         -- signed: + count gain, − count loss (shrinkage)
         sum(case when type = 'VARIANCE_RECONCILIATION' then qty else 0 end) as variance_qty
    from mv
   group by location_id, department_id, raw_material_id, day
),
run as (
  select agg.*,
         sum(net_qty) over (partition by location_id, department_id, raw_material_id
                            order by day) as closing_qty
    from agg
)
select
  r.location_id,
  r.department_id,
  d.name as department_name,
  r.day,
  round(sum((r.closing_qty - r.net_qty)      * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as opening_value,
  round(sum((r.issued_in_qty + r.purchased_qty) * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as received_value,
  round(sum(r.transferred_out_qty            * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as transferred_out_value,
  round(sum(r.sold_qty                       * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as sales_consumption_value,
  round(sum(r.wasted_qty                     * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as wastage_value,
  round(sum(-r.variance_qty                  * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as shrinkage_value,
  round(sum(r.closing_qty                    * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as closing_value,
  -- opening + received − transferred out − closing (≡ sold + wasted + shrinkage)
  round(sum((r.sold_qty + r.wasted_qty - r.variance_qty)
                                             * coalesce(w.weighted_avg_cost, 0))::numeric, 2) as consumption_value,
  exists (
    select 1 from public.stock_counts sc
     where sc.location_id = r.location_id
       and sc.department_id = r.department_id
       and sc.count_date = r.day
  ) as counted
from run r
left join public.weighted_average_cost w
  on w.raw_material_id = r.raw_material_id and w.location_id = r.location_id
left join public.departments d
  on d.id = r.department_id and d.location_id = r.location_id
group by r.location_id, r.department_id, d.name, r.day;

grant select on public.department_daily_stock to authenticated;

-- Department × day: sales vs consumption+wastage → food cost % (D7).
create or replace view public.department_daily_costing with (security_invoker = on) as
select
  coalesce(st.location_id, sa.location_id)     as location_id,
  coalesce(st.department_id, sa.department_id) as department_id,
  coalesce(st.department_name, d2.name, 'Unassigned') as department_name,
  coalesce(st.day, sa.sold_on)                 as day,
  coalesce(sa.sale_value, 0)                   as sales_value,
  coalesce(st.consumption_value, 0)            as consumption_value,
  coalesce(st.wastage_value, 0)                as wastage_value,
  coalesce(st.shrinkage_value, 0)              as shrinkage_value,
  coalesce(st.counted, false)                  as counted,
  case when coalesce(sa.sale_value, 0) > 0
       then round(coalesce(st.consumption_value, 0) / sa.sale_value * 100, 1)
       end                                     as food_cost_pct
from public.department_daily_stock st
full join public.department_sales sa
  on sa.location_id = st.location_id
 and sa.department_id is not distinct from st.department_id
 and sa.sold_on = st.day
left join public.departments d2
  on d2.id = coalesce(st.department_id, sa.department_id)
 and d2.location_id = coalesce(st.location_id, sa.location_id);

grant select on public.department_daily_costing to authenticated;

-- =============================================================================
-- END 0030
-- =============================================================================
