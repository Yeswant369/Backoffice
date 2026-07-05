-- =============================================================================
-- 0032 — Phase E: Kitchen Production v2
--
-- A. kitchen_production gains staff_meals_qty, closing_qty (nullable — null =
--    leftover not counted) and wastage_photo_path. Variance becomes
--    prepared − sold(auto) − staff meals − wasted − closing.
-- B. sub_recipe_production — the sub-recipe DAY LEDGER the user asked for:
--    opening (carry-forward) | made | available (auto) | used (AUTO from parent
--    dish sales × per-portion factor + the sub's own direct sales) | waste
--    (photo) | closing | variance. One row per sub-recipe per day.
-- C. sub_recipe_daily view — derives opening/available/used/variance. Opening
--    chains: counted closing wins, else system carry (opening+made−used−waste).
-- D. Storage bucket `wastage-photos` (private, images, 10MB, per-location).
--
-- Idempotent. Run after 0031.
-- =============================================================================

-- A. kitchen_production columns
alter table public.kitchen_production add column if not exists staff_meals_qty    numeric(14,3) not null default 0;
alter table public.kitchen_production add column if not exists closing_qty        numeric(14,3);
alter table public.kitchen_production add column if not exists wastage_photo_path text;

-- B. sub-recipe day ledger
create table if not exists public.sub_recipe_production (
  id               uuid          primary key default gen_random_uuid(),
  location_id      uuid          not null references public.locations (id) on delete cascade,
  recipe_id        uuid          not null references public.recipes (id) on delete restrict,
  production_date  date          not null default current_date,
  made_qty         numeric(14,3) not null default 0 check (made_qty >= 0),
  waste_qty        numeric(14,3) not null default 0 check (waste_qty >= 0),
  closing_qty      numeric(14,3) check (closing_qty >= 0),  -- null = not counted
  waste_photo_path text,
  notes            text,
  created_at       timestamptz   not null default now(),
  constraint uq_sub_recipe_production unique (location_id, recipe_id, production_date)
);
create index if not exists idx_sub_recipe_production_loc on public.sub_recipe_production (location_id, production_date);

alter table public.sub_recipe_production enable row level security;
drop policy if exists sub_recipe_production_select on public.sub_recipe_production;
create policy sub_recipe_production_select on public.sub_recipe_production for select to authenticated
  using (location_id in (select public.current_location_ids()));
drop policy if exists sub_recipe_production_insert on public.sub_recipe_production;
create policy sub_recipe_production_insert on public.sub_recipe_production for insert to authenticated
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists sub_recipe_production_update on public.sub_recipe_production;
create policy sub_recipe_production_update on public.sub_recipe_production for update to authenticated
  using (location_id in (select public.current_writable_location_ids()))
  with check (location_id in (select public.current_writable_location_ids()));
grant select, insert, update on public.sub_recipe_production to authenticated;

-- C. sub_recipe_daily — carry-forward + auto-used
create or replace view public.sub_recipe_daily with (security_invoker = on) as
with recursive usage as (
  -- portions of the prepared sub used per day: parent dish sales × the sub's
  -- per-portion factor (quantity_needed is per parent BATCH → ÷ parent yield),
  -- plus the sub's own direct sales.
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
    select rsv.location_id, rsv.recipe_id, rsv.sold_on, rsv.portions::numeric
      from public.recipe_sales_volume rsv
     where exists (select 1 from public.sub_recipe_production sp
                    where sp.recipe_id = rsv.recipe_id and sp.location_id = rsv.location_id)
  ) u
  group by location_id, recipe_id, day
),
entries as (
  select sp.id, sp.location_id, sp.recipe_id, sp.production_date, sp.made_qty,
         sp.waste_qty, sp.closing_qty, sp.waste_photo_path, sp.notes,
         coalesce(u.used_qty, 0) as used_qty,
         row_number() over (partition by sp.location_id, sp.recipe_id
                            order by sp.production_date) as rn
    from public.sub_recipe_production sp
    left join usage u
      on u.location_id = sp.location_id and u.recipe_id = sp.recipe_id
     and u.day = sp.production_date
),
walk as (
  select e.*, 0::numeric as opening_qty
    from entries e where e.rn = 1
  union all
  select e.*,
         -- counted closing wins; else system carry from the previous entry
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

-- A2. kitchen_production_view v3 (staff meals + closing; closing-aware variance;
-- new columns appended at the end — create-or-replace safe).
create or replace view public.kitchen_production_view with (security_invoker = on) as
select
  kp.id, kp.location_id, kp.production_date,
  kp.department_id, d.name as department_name,
  kp.recipe_id, r.name as recipe_name,
  kp.prepared_qty,
  coalesce(rsv.portions, kp.sold_qty)::numeric(14,3) as sold_qty,
  kp.wastage_qty,
  (kp.prepared_qty - coalesce(rsv.portions, kp.sold_qty) - kp.wastage_qty
     - kp.staff_meals_qty - coalesce(kp.closing_qty, 0)) as variance,
  r.selling_price,
  round(public.recipe_cogs(kp.recipe_id), 2)                 as unit_cost,
  round(kp.wastage_qty * public.recipe_cogs(kp.recipe_id), 2) as wastage_cost,
  kp.notes,
  kp.staff_meals_qty,
  kp.closing_qty,
  kp.wastage_photo_path
from public.kitchen_production kp
join public.recipes r on r.id = kp.recipe_id
left join public.departments d on d.id = kp.department_id and d.location_id = kp.location_id
left join public.recipe_sales_volume rsv
  on rsv.recipe_id = kp.recipe_id and rsv.location_id = kp.location_id
 and rsv.sold_on = kp.production_date
 and kp.department_id = r.department_id;

-- D. wastage-photos bucket (Supabase only)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('wastage-photos', 'wastage-photos', false, 10485760,
            array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif'])
    on conflict (id) do update
      set file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists wastage_photos_insert on storage.objects;
    create policy wastage_photos_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'wastage-photos'
        and (storage.foldername(name))[1] = (select public.current_location_id()::text)
      );
    drop policy if exists wastage_photos_select on storage.objects;
    create policy wastage_photos_select on storage.objects for select to authenticated
      using (
        bucket_id = 'wastage-photos'
        and (storage.foldername(name))[1] = (select public.current_location_id()::text)
      );
  end if;
end $$;

-- =============================================================================
-- END 0032
-- =============================================================================
