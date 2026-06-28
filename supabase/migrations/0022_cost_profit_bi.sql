-- =============================================================================
-- 0022 — COST & PROFIT BI (G5 theoretical-vs-actual COGS + G6 variance/profit)
--
-- pl_daily — per location per day:
--   revenue           Σ sales value (manual + POS, from department_sales)
--   theoretical_cogs  what recipes SAY the sold food cost (SALES_DEPLETION +
--                     MANUAL_SALE depletion valued at WAC)
--   wastage_cost      raw WASTAGE valued at WAC
--   variance_cost     net stock-count shrinkage (VARIANCE_RECONCILIATION:
--                     from_dept = loss +, to_dept = gain -)
--   actual_cogs       theoretical + wastage + variance  (what really left stock)
--
-- The theoretical-vs-actual gap = wastage + variance = the leakage the owner
-- can't see from recipes alone. security_invoker = location-scoped. Run after
-- 0021 (needs department_sales + weighted_average_cost). Idempotent.
-- =============================================================================

create or replace view public.pl_daily with (security_invoker = on) as
with cogs as (
  select
    il.location_id,
    -- business date: MANUAL_SALE carries the sale_date in transaction_date so its
    -- cost lands on the same day as its revenue (backdated sales reconcile).
    coalesce(il.transaction_date, (il.created_at at time zone 'Asia/Kolkata')::date) as d,
    sum(case when il.type in ('SALES_DEPLETION', 'MANUAL_SALE')
             then il.quantity * coalesce(wac.weighted_avg_cost, 0) else 0 end) as theoretical_cogs,
    sum(case when il.type = 'WASTAGE'
             then il.quantity * coalesce(wac.weighted_avg_cost, 0) else 0 end) as wastage_cost,
    sum(case when il.type = 'VARIANCE_RECONCILIATION' and il.from_department_id is not null
             then il.quantity * coalesce(wac.weighted_avg_cost, 0)
             when il.type = 'VARIANCE_RECONCILIATION' and il.to_department_id is not null
             then - il.quantity * coalesce(wac.weighted_avg_cost, 0)
             else 0 end) as variance_cost
  from public.inventory_ledger il
  left join public.weighted_average_cost wac
    on wac.raw_material_id = il.raw_material_id and wac.location_id = il.location_id
  where il.type in ('SALES_DEPLETION', 'MANUAL_SALE', 'WASTAGE', 'VARIANCE_RECONCILIATION')
  group by il.location_id, coalesce(il.transaction_date, (il.created_at at time zone 'Asia/Kolkata')::date)
),
rev as (
  select location_id, sold_on as d,
         sum(sale_value) as revenue, sum(qty_sold) as items_sold
    from public.department_sales
   group by location_id, sold_on
)
select
  coalesce(c.location_id, r.location_id) as location_id,
  coalesce(c.d, r.d)                     as pl_date,
  coalesce(r.revenue, 0)                 as revenue,
  coalesce(r.items_sold, 0)              as items_sold,
  coalesce(c.theoretical_cogs, 0)        as theoretical_cogs,
  coalesce(c.wastage_cost, 0)            as wastage_cost,
  coalesce(c.variance_cost, 0)           as variance_cost,
  coalesce(c.theoretical_cogs, 0) + coalesce(c.wastage_cost, 0)
    + coalesce(c.variance_cost, 0)       as actual_cogs
from cogs c
full join rev r on c.location_id = r.location_id and c.d = r.d;

grant select on public.pl_daily to authenticated;

-- Stamp MANUAL_SALE depletion with the sale's business date (transaction_date =
-- sale_date) so its cost lands on the same pl_daily day as its revenue, even for
-- backdated sales. POS depletion keeps transaction_date null → falls back to the
-- receipt date, which already matches its pos_sales revenue.
create or replace function public.handle_manual_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kitchen_id int;
begin
  select id into v_kitchen_id from public.departments
  where lower(name) = 'kitchen' and location_id = new.location_id limit 1;

  if v_kitchen_id is null then
    raise exception
      'No "Kitchen" department for location % — cannot explode manual sale.', new.location_id
      using errcode = 'no_data_found';
  end if;

  insert into public.inventory_ledger
    (raw_material_id, from_department_id, to_department_id, type, quantity, location_id, transaction_date)
  select ri.raw_material_id, v_kitchen_id, null, 'MANUAL_SALE',
         ri.quantity_needed * new.quantity_sold, new.location_id, new.sale_date
  from public.recipe_ingredients ri
  where ri.recipe_id = new.recipe_id and ri.raw_material_id is not null;
  return new;
end;
$$;

-- =============================================================================
-- END 0022
-- =============================================================================
