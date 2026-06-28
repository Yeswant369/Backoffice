-- =============================================================================
-- BOH ERP — Phase 5: SaaS Multi-Tenant Upgrade
--
-- Adds organizations → locations hierarchy and scopes every operational table,
-- view, and RLS policy to `location_id`. Test data is wiped (TRUNCATE, never
-- DROP). Existing triggers (prevent_mutation, handle_new_user) and the
-- supabase_realtime publication are PRESERVED.
--
-- Run once in the Supabase SQL Editor. Sections execute strictly in order.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- SECTION 1: DATA WIPE — TRUNCATE (not DROP). CASCADE clears FK dependents in
-- one shot. The prevent_mutation trigger is a ROW-level UPDATE/DELETE trigger
-- and does NOT fire on TRUNCATE, so the append-only tables clear cleanly.
-- =============================================================================
truncate table
  public.profiles,
  public.departments,
  public.vendors,
  public.raw_materials,
  public.inventory_ledger,
  public.recipes,
  public.recipe_ingredients,
  public.manual_sales_log,
  public.vendor_payments,
  public.daily_sales_reconciliation,
  public.petty_cash_expenses
cascade;

-- =============================================================================
-- SECTION 2: SAAS HIERARCHY — organizations and locations (UUID PKs).
-- google_spreadsheet_id moves OUT of the Next.js .env and INTO locations, so
-- each restaurant syncs to its own sheet.
-- =============================================================================
create table if not exists public.organizations (
  id          uuid        primary key default gen_random_uuid(),
  name        varchar(255) not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.locations (
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references public.organizations (id) on delete cascade,
  name                  varchar(255) not null,
  google_spreadsheet_id text,
  created_at            timestamptz not null default now()
);

create index if not exists idx_locations_org on public.locations (organization_id);

-- =============================================================================
-- SECTION 3: SCHEMA ALTERATION — add location_id to ALL operational tables.
-- Tables are empty (Section 1), so NOT NULL needs no default. ON DELETE CASCADE
-- means removing a location removes all of its data.
-- =============================================================================
do $$
declare
  t text;
  scoped text[] := array[
    'profiles', 'departments', 'vendors', 'raw_materials', 'inventory_ledger',
    'recipes', 'recipe_ingredients', 'manual_sales_log', 'vendor_payments',
    'daily_sales_reconciliation', 'petty_cash_expenses'
  ];
begin
  foreach t in array scoped loop
    execute format(
      'alter table public.%I add column if not exists location_id uuid not null
         references public.locations (id) on delete cascade;',
      t
    );
    execute format(
      'create index if not exists %I on public.%I (location_id);',
      'idx_' || t || '_location', t
    );
  end loop;
end $$;

-- =============================================================================
-- SECTION 4: VIEW MAINTENANCE — recreate the three math views to carry, join
-- on, and group by location_id so per-restaurant totals are exact.
-- (security_invoker = on keeps RLS scoping in effect for callers.)
-- =============================================================================

-- A. live_stock --------------------------------------------------------------
-- DROP + CREATE (not REPLACE): we prepend the new location_id column, and
-- CREATE OR REPLACE cannot reorder/rename existing view columns. Views hold no
-- data; grants are re-applied in Section 7.
drop view if exists public.live_stock;
create view public.live_stock
with (security_invoker = on) as
with movements as (
  select location_id, raw_material_id, to_department_id   as department_id,  quantity as qty
    from public.inventory_ledger where to_department_id is not null
  union all
  select location_id, raw_material_id, from_department_id as department_id, -quantity as qty
    from public.inventory_ledger where from_department_id is not null
)
select
  rm.location_id,
  rm.id                              as raw_material_id,
  rm.name                            as raw_material_name,
  rm.category,
  rm.stock_unit,
  rm.par_level,
  m.department_id,
  d.name                             as department_name,
  coalesce(sum(m.qty), 0)            as current_stock,
  (coalesce(sum(m.qty), 0) < rm.par_level) as below_par
from public.raw_materials rm
join movements m          on m.raw_material_id = rm.id and m.location_id = rm.location_id
join public.departments d on d.id = m.department_id
group by rm.location_id, rm.id, rm.name, rm.category, rm.stock_unit, rm.par_level,
         m.department_id, d.name;

-- B. vendor_dues -------------------------------------------------------------
drop view if exists public.vendor_dues;
create view public.vendor_dues
with (security_invoker = on) as
with purchases as (
  select location_id, vendor_id,
         coalesce(sum(quantity * coalesce(unit_price, 0)), 0) as total_purchased
    from public.inventory_ledger
   where type = 'PURCHASE' and vendor_id is not null
   group by location_id, vendor_id
),
payments as (
  select location_id, vendor_id, coalesce(sum(amount_paid), 0) as total_paid
    from public.vendor_payments
   group by location_id, vendor_id
)
select
  v.location_id,
  v.id                                                         as vendor_id,
  v.vendor_code,
  v.name                                                       as vendor_name,
  v.status,
  coalesce(p.total_purchased, 0)                               as total_purchased,
  coalesce(pay.total_paid, 0)                                  as total_paid,
  coalesce(p.total_purchased, 0) - coalesce(pay.total_paid, 0) as outstanding_due
from public.vendors v
left join purchases p   on p.vendor_id   = v.id and p.location_id   = v.location_id
left join payments  pay on pay.vendor_id = v.id and pay.location_id = v.location_id;

-- C. weighted_average_cost ---------------------------------------------------
drop view if exists public.weighted_average_cost;
create view public.weighted_average_cost
with (security_invoker = on) as
select
  rm.location_id,
  rm.id                                                            as raw_material_id,
  rm.name                                                          as raw_material_name,
  rm.stock_unit,
  coalesce(sum(il.quantity), 0)                                    as total_quantity_purchased,
  coalesce(sum(il.quantity * coalesce(il.unit_price, 0)), 0)       as total_spend,
  case
    when coalesce(sum(il.quantity), 0) > 0
    then sum(il.quantity * coalesce(il.unit_price, 0)) / sum(il.quantity)
    else 0
  end                                                              as weighted_avg_cost
from public.raw_materials rm
left join public.inventory_ledger il
       on il.raw_material_id = rm.id
      and il.location_id     = rm.location_id
      and il.type            = 'PURCHASE'
group by rm.location_id, rm.id, rm.name, rm.stock_unit;

-- =============================================================================
-- SECTION 5: MULTI-TENANT RLS
-- Helper: resolve the caller's location_id WITHOUT recursion. SECURITY DEFINER
-- runs as the owner (bypasses RLS), so reading profiles here is safe.
-- =============================================================================
create or replace function public.current_location_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select location_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_org_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id
  from public.locations
  where id = (select location_id from public.profiles where id = auth.uid());
$$;

grant execute on function public.current_location_id() to authenticated;
grant execute on function public.current_org_id() to authenticated;

-- Tenant config tables: a user sees only their own org / location.
alter table public.organizations enable row level security;
alter table public.locations     enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_org_id());

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations
  for select to authenticated
  using (id = public.current_location_id());

-- Admins may edit their own location (e.g. set the Google Sheet id).
drop policy if exists locations_update on public.locations;
create policy locations_update on public.locations
  for update to authenticated
  using (id = public.current_location_id() and public.is_admin())
  with check (id = public.current_location_id() and public.is_admin());

-- --- Operational tables: drop the old "true" policies, scope to location -----

-- Ensure RLS is ENABLED on every operational table. Idempotent — re-enabling an
-- already-enabled table is a no-op. Without this, the policies below would exist
-- but NOT be enforced (silent tenant-isolation hole) if RLS was ever disabled.
do $$
declare
  t text;
  all_op text[] := array[
    'profiles', 'departments', 'vendors', 'raw_materials', 'inventory_ledger',
    'recipes', 'recipe_ingredients', 'manual_sales_log', 'vendor_payments',
    'daily_sales_reconciliation', 'petty_cash_expenses'
  ];
begin
  foreach t in array all_op loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Mutable tables → full access within the caller's location.
do $$
declare
  t text;
  mutable text[] := array[
    'departments', 'vendors', 'raw_materials', 'recipes', 'recipe_ingredients',
    'manual_sales_log', 'daily_sales_reconciliation', 'petty_cash_expenses'
  ];
begin
  foreach t in array mutable loop
    execute format('drop policy if exists %I_all on public.%I;', t, t);
    execute format(
      'create policy %I_all on public.%I for all to authenticated
         using (location_id = public.current_location_id())
         with check (location_id = public.current_location_id());',
      t, t
    );
  end loop;
end $$;

-- Append-only tables → SELECT + INSERT only, location-scoped. UPDATE/DELETE stay
-- blocked by prevent_mutation and absent grants (immutability preserved).
drop policy if exists inventory_ledger_insert on public.inventory_ledger;
create policy inventory_ledger_insert on public.inventory_ledger
  for insert to authenticated
  with check (location_id = public.current_location_id());
drop policy if exists inventory_ledger_select on public.inventory_ledger;
create policy inventory_ledger_select on public.inventory_ledger
  for select to authenticated
  using (location_id = public.current_location_id());

drop policy if exists vendor_payments_insert on public.vendor_payments;
create policy vendor_payments_insert on public.vendor_payments
  for insert to authenticated
  with check (location_id = public.current_location_id());
drop policy if exists vendor_payments_select on public.vendor_payments;
create policy vendor_payments_select on public.vendor_payments
  for select to authenticated
  using (location_id = public.current_location_id());

-- profiles → read colleagues in your location; update only your own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (location_id = public.current_location_id());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and location_id = public.current_location_id());

-- =============================================================================
-- SECTION 6: TRIGGER MAINTENANCE — preserve handle_new_user, extend it to set
-- location_id from signup metadata (raw_user_meta_data->>'location_id'). Guarded
-- so a missing location_id doesn't break the auth.users insert; the admin can
-- assign the profile later. prevent_mutation is left untouched.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roles    int[];
  v_location uuid;
begin
  begin
    select array(
             select jsonb_array_elements_text(new.raw_user_meta_data -> 'roles')::int
           )
      into v_roles;
  exception when others then
    v_roles := null;
  end;

  if v_roles is null or array_length(v_roles, 1) is null then
    v_roles := array[3]::int[];
  end if;

  begin
    v_location := (new.raw_user_meta_data ->> 'location_id')::uuid;
  exception when others then
    v_location := null;
  end;

  -- Only provision a profile once we know the tenant (location is NOT NULL).
  if v_location is not null then
    insert into public.profiles (id, full_name, roles, location_id)
    values (new.id, new.raw_user_meta_data ->> 'full_name', v_roles, v_location)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- Re-bind the trigger (idempotent; same definition as before).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- SECTION 7: GRANTS — new tenant tables + re-grant views.
-- =============================================================================
grant select on public.organizations to authenticated;
grant select, update on public.locations to authenticated;

grant select on public.live_stock            to authenticated;
grant select on public.vendor_dues           to authenticated;
grant select on public.weighted_average_cost to authenticated;

-- =============================================================================
-- SECTION 8: BOOTSTRAP — re-seed one tenant so you aren't locked out after the
-- wipe. Runs as the SQL-editor role (bypasses RLS). Replace the spreadsheet id /
-- admin uuid as needed.
-- =============================================================================
do $$
declare
  v_org uuid;
  v_loc uuid;
begin
  -- Org/location: create only if missing; otherwise reuse the existing one
  -- (organizations/locations are NOT truncated, so they survive re-runs).
  if not exists (select 1 from public.organizations) then
    insert into public.organizations (name)
      values ('Thrayam Foods')
      returning id into v_org;

    insert into public.locations (organization_id, name, google_spreadsheet_id)
      values (v_org, 'Main Kitchen', '1GWquuT7GBANjuiXgucQ5TPBlUbu6RiYXrnQ7LPriipA')
      returning id into v_loc;
  else
    select id into v_loc from public.locations order by created_at limit 1;
  end if;

  -- Departments AND the admin profile ARE truncated each run (Section 1), so
  -- ALWAYS restore them — otherwise a re-run wipes them and locks you out.
  insert into public.departments (id, name, location_id) values
    (1, 'Store',   v_loc),
    (2, 'Kitchen', v_loc),
    (3, 'Bar',     v_loc),
    (4, 'Bakery',  v_loc)
  on conflict (id) do update
    set name = excluded.name, location_id = excluded.location_id;

  insert into public.profiles (id, full_name, roles, location_id)
    values ('0c9fc99a-8ec3-47fd-819b-2190292f9efa',
            'Yeswant Sai Attuluri', '{1,2,3,4}', v_loc)
  on conflict (id) do update
    set roles = excluded.roles,
        location_id = excluded.location_id,
        full_name = excluded.full_name;
end $$;

-- =============================================================================
-- SECTION 9 (OPTIONAL, RECOMMENDED): auto-stamp location_id on insert so the
-- app doesn't have to set it on every INSERT. The BEFORE INSERT trigger fills a
-- NULL location_id from the caller's session. RLS WITH CHECK still enforces it.
-- Comment out if you prefer the app to set location_id explicitly everywhere.
-- =============================================================================
create or replace function public.set_location_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.location_id is null then
    new.location_id := public.current_location_id();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
  -- profiles excluded: provisioned by handle_new_user with an explicit location.
  scoped text[] := array[
    'vendors', 'raw_materials', 'inventory_ledger', 'recipes',
    'recipe_ingredients', 'manual_sales_log', 'vendor_payments',
    'daily_sales_reconciliation', 'petty_cash_expenses'
  ];
begin
  foreach t in array scoped loop
    execute format('drop trigger if exists trg_set_location on public.%I;', t);
    execute format(
      'create trigger trg_set_location before insert on public.%I
         for each row execute function public.set_location_id();',
      t
    );
  end loop;
end $$;

-- =============================================================================
-- END OF PHASE 5 MIGRATION
-- =============================================================================
