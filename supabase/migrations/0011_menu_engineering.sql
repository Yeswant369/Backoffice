-- =============================================================================
-- Migration 0011_menu_engineering.sql
-- Epic 3: per-recipe sales-volume fact table + recursive COGS + costing/volume views.
-- Depends on 0010 (sub_recipe_id, pos_item_code) and 0007 (weighted_average_cost).
-- =============================================================================

-- SECTION 1: pos_sales — per-recipe portions-sold fact (one row per matched POS line).
-- Written by the Epic-1 POS ingestion engine in the SAME transaction it posts the
-- SALES_DEPLETION ledger rows. This is the ONLY place per-recipe portion counts live;
-- the ledger is exploded to raw_material level and cannot reconstruct them.
create table if not exists public.pos_sales (
  id            uuid        primary key default gen_random_uuid(),
  location_id   uuid        not null references public.locations (id) on delete cascade,
  recipe_id     uuid        not null references public.recipes (id) on delete restrict,
  quantity      int         not null default 1 check (quantity > 0),
  pos_item_code varchar(80),
  sold_at       timestamptz not null default now(),
  raw_payload   jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_pos_sales_location  on public.pos_sales (location_id);
create index if not exists idx_pos_sales_recipe     on public.pos_sales (recipe_id);
create index if not exists idx_pos_sales_loc_soldat on public.pos_sales (location_id, sold_at desc);
alter table public.pos_sales enable row level security;
drop policy if exists pos_sales_all on public.pos_sales;
create policy pos_sales_all on public.pos_sales for all to authenticated
  using (location_id = public.current_location_id())
  with check (location_id = public.current_location_id());
grant select, insert, update, delete on public.pos_sales to authenticated;
drop trigger if exists trg_set_location on public.pos_sales;
create trigger trg_set_location before insert on public.pos_sales
  for each row execute function public.set_location_id();

-- SECTION 2: recipe_cogs(recipe_id) — recursive plate cost valued at WAC.
-- Returns the per-PORTION cost of one recipe: sums raw-material legs
-- (quantity_needed * weighted_avg_cost) plus sub-recipe legs (quantity_needed *
-- sub-recipe plate cost), divides the batch total by yield_portions, then applies
-- overhead_percentage. Cycle-safe via a visited path array. SECURITY INVOKER so
-- weighted_average_cost / recipe_ingredients stay RLS-scoped to the caller.
create or replace function public.recipe_cogs(p_recipe_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with recursive exploded as (
    -- root: every ingredient line of the target recipe at depth 0
    select
      ri.recipe_id,
      ri.raw_material_id,
      ri.sub_recipe_id,
      ri.quantity_needed,
      array[ri.recipe_id]                          as path,
      1::numeric                                    as multiplier
    from public.recipe_ingredients ri
    where ri.recipe_id = p_recipe_id

    union all

    -- descend into each sub-recipe: child line qty scaled by parent line qty,
    -- and PER-PORTION-normalised by the child recipe's yield_portions.
    select
      child.recipe_id,
      child.raw_material_id,
      child.sub_recipe_id,
      child.quantity_needed,
      e.path || child.recipe_id,
      e.multiplier
        * e.quantity_needed
        / greatest(coalesce(sub.yield_portions, 1), 1)  as multiplier
    from exploded e
    join public.recipes sub               on sub.id = e.sub_recipe_id
    join public.recipe_ingredients child  on child.recipe_id = e.sub_recipe_id
    where e.sub_recipe_id is not null
      and not (child.recipe_id = any (e.path))    -- cycle guard
  ),
  -- value only the raw-material leaves (sub_recipe legs were expanded above)
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
           (b.batch_cost / greatest(r.yield_portions, 1))   -- plate (per-portion) cost
           * (1 + coalesce(r.overhead_percentage, 0) / 100.0),
           4
         )
  from public.recipes r
  cross join batch b
  where r.id = p_recipe_id;
$$;
grant execute on function public.recipe_cogs(uuid) to authenticated;

-- SECTION 3: recipe_costing view — selling price, COGS, margin per recipe.
drop view if exists public.recipe_costing;
create view public.recipe_costing with (security_invoker = on) as
select
  r.id                                              as recipe_id,
  r.location_id,
  r.name                                            as recipe_name,
  r.category,
  r.selling_price,
  public.recipe_cogs(r.id)                          as cogs,
  (r.selling_price - public.recipe_cogs(r.id))      as margin_value,
  case when r.selling_price > 0
       then round((r.selling_price - public.recipe_cogs(r.id))
                  / r.selling_price * 100.0, 2)
       else 0 end                                   as margin_pct,
  case when r.selling_price > 0
       then round(public.recipe_cogs(r.id) / r.selling_price * 100.0, 2)
       else 0 end                                   as food_cost_pct
from public.recipes r;
grant select on public.recipe_costing to authenticated;

-- SECTION 4: recipe_sales_volume view — portions sold per recipe (pos_sales + manual).
-- Aggregated over ALL time; the page filters by date in SQL (see query plan) because
-- a parameterised date range can't live in a view. Exposes both sources unioned.
drop view if exists public.recipe_sales_volume;
create view public.recipe_sales_volume with (security_invoker = on) as
select
  s.location_id,
  s.recipe_id,
  s.sold_on,
  sum(s.quantity)::bigint as portions
from (
  select location_id, recipe_id, (sold_at at time zone 'Asia/Kolkata')::date as sold_on, quantity
  from public.pos_sales
  union all
  select location_id, recipe_id, sale_date as sold_on, quantity_sold as quantity
  from public.manual_sales_log
) s
group by s.location_id, s.recipe_id, s.sold_on;
grant select on public.recipe_sales_volume to authenticated;

-- SECTION 5: realtime (optional; keeps the matrix live as POS lines arrive).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='pos_sales') then
    execute 'alter publication supabase_realtime add table public.pos_sales';
  end if;
end $$;