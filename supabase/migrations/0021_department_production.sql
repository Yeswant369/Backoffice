-- =============================================================================
-- 0021 — DEPARTMENT PRODUCTION LAYER (Kitchen Management: G1–G4)
--
-- A. recipes.department_id — which department prepares/serves each menu item.
-- B. kitchen_production — per (department, item, day): prepared / sold / wasted
--    (prepared-ITEM wastage) → derived variance. The "Kitchen sheet" (⑧).
-- C. Views: kitchen_production_view (variance + item cost), department_sales
--    (sales by department), department_pl (issued cost vs sale value vs item
--    wastage per department).
--
-- All views security_invoker = on (location-scoped). Run after 0020. Idempotent.
-- =============================================================================

-- A. Menu item → department.
alter table public.recipes
  add column if not exists department_id int references public.departments (id) on delete set null;
create index if not exists idx_recipes_department on public.recipes (department_id);

-- B. Kitchen production / prep sheet (mutable — counts get corrected during the day).
create table if not exists public.kitchen_production (
  id              uuid          primary key default gen_random_uuid(),
  location_id     uuid          not null references public.locations (id) on delete cascade,
  department_id   int           references public.departments (id) on delete set null,
  recipe_id       uuid          not null references public.recipes (id) on delete restrict,
  production_date date          not null default current_date,
  prepared_qty    numeric(14,3) not null default 0 check (prepared_qty >= 0),
  sold_qty        numeric(14,3) not null default 0 check (sold_qty >= 0),
  wastage_qty     numeric(14,3) not null default 0 check (wastage_qty >= 0),
  notes           text,
  created_at      timestamptz   not null default now(),
  constraint uq_kitchen_production unique (location_id, department_id, recipe_id, production_date)
);
create index if not exists idx_kitchen_production_location on public.kitchen_production (location_id);

alter table public.kitchen_production enable row level security;
drop policy if exists kitchen_production_select on public.kitchen_production;
create policy kitchen_production_select on public.kitchen_production for select to authenticated
  using (location_id in (select public.current_location_ids()));
drop policy if exists kitchen_production_insert on public.kitchen_production;
create policy kitchen_production_insert on public.kitchen_production for insert to authenticated
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists kitchen_production_update on public.kitchen_production;
create policy kitchen_production_update on public.kitchen_production for update to authenticated
  using (location_id in (select public.current_writable_location_ids()))
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists kitchen_production_delete on public.kitchen_production;
create policy kitchen_production_delete on public.kitchen_production for delete to authenticated
  using (location_id in (select public.current_writable_location_ids()));

grant select, insert, update, delete on public.kitchen_production to authenticated;

-- C1. kitchen_production_view — prepared/sold/wasted + variance + item cost.
create or replace view public.kitchen_production_view with (security_invoker = on) as
select
  kp.id, kp.location_id, kp.production_date,
  kp.department_id, d.name as department_name,
  kp.recipe_id, r.name as recipe_name,
  kp.prepared_qty, kp.sold_qty, kp.wastage_qty,
  (kp.prepared_qty - kp.sold_qty - kp.wastage_qty) as variance,
  r.selling_price,
  round(public.recipe_cogs(kp.recipe_id), 2)                 as unit_cost,
  round(kp.wastage_qty * public.recipe_cogs(kp.recipe_id), 2) as wastage_cost,
  kp.notes
from public.kitchen_production kp
join public.recipes r on r.id = kp.recipe_id
left join public.departments d on d.id = kp.department_id and d.location_id = kp.location_id;

grant select on public.kitchen_production_view to authenticated;

-- C2. department_sales — sales (manual + POS) rolled to the item's department.
create or replace view public.department_sales with (security_invoker = on) as
select location_id, department_id, sold_on,
       sum(qty)        as qty_sold,
       sum(sale_value) as sale_value
from (
  select m.location_id, r.department_id, m.sale_date as sold_on,
         m.quantity_sold as qty, m.quantity_sold * r.selling_price as sale_value
    from public.manual_sales_log m
    join public.recipes r on r.id = m.recipe_id and r.location_id = m.location_id
  union all
  select p.location_id, r.department_id,
         (p.sold_at at time zone 'Asia/Kolkata')::date as sold_on,
         p.quantity as qty, p.quantity * r.selling_price as sale_value
    from public.pos_sales p
    join public.recipes r on r.id = p.recipe_id and r.location_id = p.location_id
) s
group by location_id, department_id, sold_on;

grant select on public.department_sales to authenticated;

-- C3. department_pl — per department: raw issued-in cost (net of inter-dept
-- transfers out), sale revenue, item wastage. Keeps the NULL/Unassigned bucket.
create or replace view public.department_pl with (security_invoker = on) as
with issued as (
  select location_id, department_id, sum(amt) as issued_cost
  from (
    -- raw received INTO a department (issue or transfer-in) → +cost
    select il.location_id, il.to_department_id as department_id,
           il.quantity * coalesce(wac.weighted_avg_cost, 0) as amt
      from public.inventory_ledger il
      left join public.weighted_average_cost wac
        on wac.raw_material_id = il.raw_material_id and wac.location_id = il.location_id
     where il.type in ('ISSUE_TO_KITCHEN', 'INTER_DEPARTMENT_TRANSFER')
       and il.to_department_id is not null
    union all
    -- raw transferred OUT of a department → -cost (so transfers net to zero org-wide)
    select il.location_id, il.from_department_id as department_id,
           - il.quantity * coalesce(wac.weighted_avg_cost, 0) as amt
      from public.inventory_ledger il
      left join public.weighted_average_cost wac
        on wac.raw_material_id = il.raw_material_id and wac.location_id = il.location_id
     where il.type = 'INTER_DEPARTMENT_TRANSFER' and il.from_department_id is not null
  ) x
  group by location_id, department_id
),
sold as (
  select location_id, department_id,
         sum(sale_value) as sale_value, sum(qty_sold) as items_sold
    from public.department_sales
   group by location_id, department_id
),
waste as (
  select location_id, department_id, sum(wastage_cost) as item_wastage_cost
    from public.kitchen_production_view
   group by location_id, department_id
),
keys as (
  select location_id, department_id from issued
  union select location_id, department_id from sold
  union select location_id, department_id from waste
  union select location_id, id as department_id from public.departments
)
select
  k.location_id, k.department_id, d.name as department_name,
  coalesce(i.issued_cost, 0)       as issued_cost,
  coalesce(s.sale_value, 0)        as sale_value,
  coalesce(s.items_sold, 0)        as items_sold,
  coalesce(w.item_wastage_cost, 0) as item_wastage_cost
from keys k
left join public.departments d on d.id = k.department_id and d.location_id = k.location_id
left join issued i on i.location_id = k.location_id and i.department_id is not distinct from k.department_id
left join sold   s on s.location_id = k.location_id and s.department_id is not distinct from k.department_id
left join waste  w on w.location_id = k.location_id and w.department_id is not distinct from k.department_id;

grant select on public.department_pl to authenticated;

-- =============================================================================
-- END 0021
-- =============================================================================
