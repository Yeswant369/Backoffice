-- =============================================================================
-- 0023 — G7 anomaly detection + G10 vendor approval + sold-qty automation
--
-- A. vendors.approved — "fixed unless added & approved": existing vendors are
--    grandfathered (add-column default true) but NEW vendors default to pending
--    (alter-default false). Purchases are restricted to approved vendors in-app.
-- B. kitchen_production_view — "sold" now AUTO-derives from actual sales
--    (recipe_sales_volume) so variance needs less manual entry.
-- C. anomalies — rule-based feed (negative stock, big count variance, purchase
--    price spikes, unmapped POS, heavy item wastage) for proactive flags.
--
-- Idempotent. Run after 0022.
-- =============================================================================

-- A. Vendor approval. The add/alter pair grandfathers existing rows (default
-- true on add) while making future inserts pending (default false), and both
-- statements are safe to re-run.
alter table public.vendors add column if not exists approved boolean not null default true;
alter table public.vendors alter column approved set default false;
alter table public.vendors add column if not exists approved_at timestamptz;
alter table public.vendors add column if not exists approved_by uuid references public.profiles (id) on delete set null;

-- B. kitchen_production_view — sold qty preferred from actual sales volume.
create or replace view public.kitchen_production_view with (security_invoker = on) as
select
  kp.id, kp.location_id, kp.production_date,
  kp.department_id, d.name as department_name,
  kp.recipe_id, r.name as recipe_name,
  kp.prepared_qty,
  coalesce(rsv.portions, kp.sold_qty)::numeric(14,3) as sold_qty,
  kp.wastage_qty,
  (kp.prepared_qty - coalesce(rsv.portions, kp.sold_qty) - kp.wastage_qty) as variance,
  r.selling_price,
  round(public.recipe_cogs(kp.recipe_id), 2)                 as unit_cost,
  round(kp.wastage_qty * public.recipe_cogs(kp.recipe_id), 2) as wastage_cost,
  kp.notes
from public.kitchen_production kp
join public.recipes r on r.id = kp.recipe_id
left join public.departments d on d.id = kp.department_id and d.location_id = kp.location_id
left join public.recipe_sales_volume rsv
  on rsv.recipe_id = kp.recipe_id and rsv.location_id = kp.location_id
 and rsv.sold_on = kp.production_date
 -- attach sales only to the row in the recipe's OWN department, so a recipe
 -- prepared in two departments never has the full sales broadcast to both.
 and kp.department_id = r.department_id;

-- C. anomalies — typed, rule-based flags from existing data. security_invoker.
create or replace view public.anomalies with (security_invoker = on) as
select location_id, 'NEGATIVE_STOCK'::text as kind, 'high'::text as severity,
       raw_material_name::text as entity,
       (coalesce(department_name, '?') || ': ' || round(current_stock, 2)::text
         || ' ' || stock_unit)::text as detail,
       current_stock::numeric as metric, null::date as occurred_on
  from public.live_stock
 where current_stock < 0
union all
select location_id, 'STOCK_VARIANCE',
       case when abs(variance_value) > 2000 then 'high' else 'medium' end,
       raw_material_name,
       ('count off by ' || round(variance, 2)::text || ' ' || stock_unit)::text,
       variance_value, count_date
  from public.stock_count_variance
 where abs(variance_value) > 500
   and count_date >= (now() at time zone 'Asia/Kolkata')::date - 60
union all
select il.location_id, 'PRICE_SPIKE', 'medium', rm.name,
       ('paid ' || round(il.unit_price, 2)::text || ' vs avg '
         || round(wac.weighted_avg_cost, 2)::text)::text,
       il.unit_price, (il.created_at at time zone 'Asia/Kolkata')::date
  from public.inventory_ledger il
  join public.raw_materials rm on rm.id = il.raw_material_id
  join public.weighted_average_cost wac
    on wac.raw_material_id = il.raw_material_id and wac.location_id = il.location_id
 where il.type = 'PURCHASE'
   and wac.weighted_avg_cost > 0
   and il.unit_price > 1.5 * wac.weighted_avg_cost
   and il.created_at >= now() - interval '60 days'
union all
select location_id, 'UNMAPPED_SALE', 'medium',
       coalesce(item_name, pos_item_code, 'unknown')::text,
       'unmapped POS item — map it to a recipe'::text,
       quantity::numeric, (created_at at time zone 'Asia/Kolkata')::date
  from public.unmapped_sales
 where resolved = false
union all
select location_id, 'ITEM_WASTAGE', 'medium', recipe_name,
       (coalesce(department_name, '?') || ' wasted ' || round(wastage_qty, 2)::text)::text,
       wastage_cost, production_date
  from public.kitchen_production_view
 where wastage_cost > 200;

grant select on public.anomalies to authenticated;

-- =============================================================================
-- END 0023
-- =============================================================================
