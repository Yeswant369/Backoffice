-- =============================================================================
-- 0033 — Phase E remediation (review wf_3bf040d1)
--
-- A. sub_recipe_daily v2 — GAP DAYS: the previous walk only materialized days
--    with a saved sheet row, so usage on skipped days (holiday, forgotten save)
--    vanished from the carry — the next opening was overstated by exactly the
--    skipped usage. The walk now runs over the UNION of entry-days and
--    usage-days (per tracked sub, from its first entry), synthesizing
--    made=0 / waste=0 / closing=null rows so gap-day usage depletes the chain.
--    Also: the own-direct-sales arm is now gated on the recipe being REFERENCED
--    as a sub-recipe (not on having sheet entries) — a dish mistakenly saved on
--    the sub sheet no longer counts its own sales as "used" forever.
--
-- B. sub_recipe_production: DELETE policy + full grant (mistake rows were
--    unremovable; the hero fold also missed the table's grants entirely).
--
-- Idempotent. Run after 0032.
-- =============================================================================

create or replace view public.sub_recipe_daily with (security_invoker = on) as
with recursive usage as (
  select location_id, recipe_id, day, sum(used) as used_qty
  from (
    select rsv.location_id, ri.sub_recipe_id as recipe_id, rsv.sold_on as day,
           rsv.portions * ri.quantity_needed / greatest(p.yield_portions, 1) as used
      from public.recipe_ingredients ri
      join public.recipes p on p.id = ri.recipe_id
      join public.recipe_sales_volume rsv
        on rsv.recipe_id = p.id and rsv.location_id = p.location_id
     where ri.sub_recipe_id is not null
    union all
    -- the sub's own direct sales — only for recipes actually used AS subs
    select rsv.location_id, rsv.recipe_id, rsv.sold_on, rsv.portions::numeric
      from public.recipe_sales_volume rsv
     where exists (select 1 from public.recipe_ingredients ri
                    where ri.sub_recipe_id = rsv.recipe_id)
  ) u
  group by location_id, recipe_id, day
),
tracked as (
  select location_id, recipe_id, min(production_date) as first_day
    from public.sub_recipe_production
   group by location_id, recipe_id
),
day_spine as (
  select t.location_id, t.recipe_id, d.day
    from tracked t
    join (
      select location_id, recipe_id, production_date as day
        from public.sub_recipe_production
      union
      select location_id, recipe_id, day from usage
    ) d
      on d.location_id = t.location_id and d.recipe_id = t.recipe_id
   where d.day >= t.first_day
),
entries as (
  select ds.location_id, ds.recipe_id, ds.day as production_date,
         sp.id,
         coalesce(sp.made_qty, 0)::numeric(14,3)  as made_qty,
         coalesce(sp.waste_qty, 0)::numeric(14,3) as waste_qty,
         sp.closing_qty, sp.waste_photo_path, sp.notes,
         coalesce(u.used_qty, 0)   as used_qty,
         row_number() over (partition by ds.location_id, ds.recipe_id
                            order by ds.day) as rn
    from day_spine ds
    left join public.sub_recipe_production sp
      on sp.location_id = ds.location_id and sp.recipe_id = ds.recipe_id
     and sp.production_date = ds.day
    left join usage u
      on u.location_id = ds.location_id and u.recipe_id = ds.recipe_id
     and u.day = ds.day
),
walk as (
  select e.*, 0::numeric as opening_qty
    from entries e where e.rn = 1
  union all
  select e.*,
         coalesce(w.closing_qty, w.opening_qty + w.made_qty - w.used_qty - w.waste_qty)
    from entries e
    join walk w on w.location_id = e.location_id and w.recipe_id = e.recipe_id
               and w.rn = e.rn - 1
)
select
  w.id, w.location_id, w.recipe_id, r.name as recipe_name,
  r.department_id, w.production_date,
  round(w.opening_qty, 3)                        as opening_qty,
  w.made_qty,
  round(w.opening_qty + w.made_qty, 3)           as available_qty,
  round(w.used_qty, 3)                           as used_qty,
  w.waste_qty,
  w.closing_qty,
  case when w.closing_qty is not null
       then round(w.opening_qty + w.made_qty - w.used_qty - w.waste_qty - w.closing_qty, 3)
       end                                       as variance_qty,
  round(public.recipe_cogs(w.recipe_id), 2)      as unit_cost,
  w.waste_photo_path, w.notes
from walk w
join public.recipes r on r.id = w.recipe_id;

grant select on public.sub_recipe_daily to authenticated;

-- B. delete path for mistake rows + complete grants
drop policy if exists sub_recipe_production_delete on public.sub_recipe_production;
create policy sub_recipe_production_delete on public.sub_recipe_production for delete to authenticated
  using (location_id in (select public.current_writable_location_ids()));
grant select, insert, update, delete on public.sub_recipe_production to authenticated;

-- =============================================================================
-- END 0033
-- =============================================================================
