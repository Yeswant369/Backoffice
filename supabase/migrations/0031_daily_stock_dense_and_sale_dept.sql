-- =============================================================================
-- 0031 — Phase D remediation (review wf_afc78198)
--
-- A. department_daily_stock DENSIFIED: the previous version only emitted rows
--    on days a material MOVED, so day-level Opening/Closing understated the
--    department's true inventory (idle materials were excluded) and
--    Opening(d) ≠ Closing(d−1) in the day book. A per-material calendar from
--    first movement to today makes balances carry through idle days:
--    Opening(d) = Closing(d−1) always, and counted-day Closing = the count.
--
-- B. handle_manual_sale now depletes from the RECIPE'S OWN department (falling
--    back to Kitchen) — revenue is attributed to the recipe's department in
--    department_sales, so cost must land in the same department or per-dept
--    food-cost% is structurally wrong (Bar sales / Kitchen cost).
--    (POS depletion still posts from Kitchen: its ledger idempotency key is
--    per-material per-order and cannot carry a department dimension without a
--    re-keying migration — documented limitation, shown in the page copy.)
--
-- Idempotent. Run after 0030.
-- =============================================================================

create or replace view public.department_daily_stock with (security_invoker = on) as
with mv as (
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
         sum(case when type = 'VARIANCE_RECONCILIATION' then qty else 0 end) as variance_qty
    from mv
   group by location_id, department_id, raw_material_id, day
),
-- one row per (dept, material, DAY) from first movement to today — idle days
-- included so balances carry forward.
spine as (
  select location_id, department_id, raw_material_id,
         generate_series(min(day), (now() at time zone 'Asia/Kolkata')::date,
                         interval '1 day')::date as day
    from agg
   group by location_id, department_id, raw_material_id
),
dense as (
  select s.location_id, s.department_id, s.raw_material_id, s.day,
         coalesce(a.net_qty, 0)             as net_qty,
         coalesce(a.issued_in_qty, 0)       as issued_in_qty,
         coalesce(a.purchased_qty, 0)       as purchased_qty,
         coalesce(a.transferred_out_qty, 0) as transferred_out_qty,
         coalesce(a.sold_qty, 0)            as sold_qty,
         coalesce(a.wasted_qty, 0)          as wasted_qty,
         coalesce(a.variance_qty, 0)        as variance_qty
    from spine s
    left join agg a
      on a.location_id = s.location_id and a.department_id = s.department_id
     and a.raw_material_id = s.raw_material_id and a.day = s.day
),
run as (
  select dense.*,
         sum(net_qty) over (partition by location_id, department_id, raw_material_id
                            order by day) as closing_qty
    from dense
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

-- B. Manual-sale depletion from the recipe's own department (fallback Kitchen).
create or replace function public.handle_manual_sale()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kitchen_id int;
  v_from_dept  int;
begin
  select id into v_kitchen_id from public.departments
  where lower(name) = 'kitchen' and location_id = new.location_id limit 1;

  if v_kitchen_id is null then
    raise exception
      'No "Kitchen" department for location % — cannot explode manual sale.', new.location_id
      using errcode = 'no_data_found';
  end if;

  -- Cost lands where the revenue is attributed (department_sales groups by the
  -- recipe's department) so per-department food-cost% stays coherent.
  select coalesce(r.department_id, v_kitchen_id) into v_from_dept
  from public.recipes r where r.id = new.recipe_id;
  v_from_dept := coalesce(v_from_dept, v_kitchen_id);

  insert into public.inventory_ledger
    (raw_material_id, from_department_id, to_department_id, type, quantity, location_id, transaction_date)
  select ri.raw_material_id, v_from_dept, null, 'MANUAL_SALE',
         ri.quantity_needed * new.quantity_sold, new.location_id, new.sale_date
  from public.recipe_ingredients ri
  where ri.recipe_id = new.recipe_id and ri.raw_material_id is not null;
  return new;
end;
$$;

-- =============================================================================
-- END 0031
-- =============================================================================
