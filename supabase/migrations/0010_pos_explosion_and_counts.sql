-- =============================================================================
-- BOH ERP — Phase 6: POS Explosion + Sub-Recipes + Stock Counts (TvA)
--
-- Single source of truth for the schema needs of FOUR epics:
--   EPIC 1  POS ingestion → recipe explosion → SALES_DEPLETION ledger postings
--   EPIC 2  Sub-recipe (recipe-as-ingredient) costing & explosion
--   EPIC 3  Unmapped-sales triage + per-tenant webhook auth
--   EPIC 4  Manager stock counts → Theory-vs-Actual (TvA) variance
--
-- Conventions inherited from 0007 (multi-tenant):
--   * Every operational table: location_id uuid NOT NULL refs locations
--     ON DELETE CASCADE, RLS enabled, single FOR ALL policy scoped to
--     current_location_id(), grants to authenticated, set_location_id()
--     BEFORE INSERT trigger, index on location_id.
--   * inventory_ledger stays APPEND-ONLY (prevent_mutation blocks UPDATE/DELETE;
--     DDL/ALTER + INSERT are fine). We only ALTER its CHECK + add INSERT data.
--
-- Fully idempotent. Run once in the Supabase SQL Editor; safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- SECTION 1: LEDGER — add the SALES_DEPLETION movement type.
--
-- The original type CHECK (0001) is an INLINE, UNNAMED column constraint. Postgres
-- auto-named it `inventory_ledger_type_check`. We cannot ADD a value to an inline
-- CHECK; we DROP it by its system name and re-add it as a NAMED constraint that
-- carries every legacy value plus SALES_DEPLETION. ALTER TABLE is DDL and is NOT
-- intercepted by the prevent_mutation row trigger (that trigger only fires on
-- row-level UPDATE/DELETE, never on DDL), so this is safe on the append-only table.
--
-- SALES_DEPLETION convention: from_department_id = the consuming department
-- (e.g. Kitchen/Bar), to_department_id = NULL  → a pure outflow, exactly like
-- WASTAGE/MANUAL_SALE. live_stock already subtracts from_department rows, so POS
-- depletion reduces on-hand with zero view changes.
-- =============================================================================

-- Drop whatever CHECK currently constrains inventory_ledger.type, addressed by its
-- real catalog name (robust even if a prior run already renamed it). This finds
-- the single CHECK constraint that references the `type` column.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any (con.conkey)
    where nsp.nspname = 'public'
      and rel.relname = 'inventory_ledger'
      and con.contype = 'c'
      and att.attname = 'type'
  loop
    execute format('alter table public.inventory_ledger drop constraint %I;', c.conname);
  end loop;
end $$;

-- Re-add as a NAMED constraint including the new value. IF the constraint already
-- exists (re-run), the loop above removed it first, so this always succeeds.
alter table public.inventory_ledger
  add constraint inventory_ledger_type_check
  check (type in (
    'PURCHASE',
    'ISSUE_TO_KITCHEN',
    'INTER_DEPARTMENT_TRANSFER',
    'MANUAL_SALE',
    'WASTAGE',
    'VARIANCE_RECONCILIATION',
    'SALES_DEPLETION'
  ));

-- =============================================================================
-- SECTION 2: RECIPES — POS item code (maps an external POS SKU → one recipe).
-- =============================================================================
alter table public.recipes
  add column if not exists pos_item_code varchar(80);

-- Plain lookup index (covers JOINs from sales ingestion even for NULLs excluded
-- by the partial unique below).
create index if not exists idx_recipes_pos_item_code
  on public.recipes (pos_item_code);

-- A POS code must be unique WITHIN a location (two tenants may legitimately reuse
-- the same external SKU). Partial: only enforce where a code is actually set, so
-- the many recipes without a POS mapping don't collide on NULL.
create unique index if not exists uq_recipes_location_pos_item_code
  on public.recipes (location_id, pos_item_code)
  where pos_item_code is not null;

-- =============================================================================
-- SECTION 3: RECIPE_INGREDIENTS — support SUB-RECIPES (recipe-as-ingredient).
--
-- A row is now EITHER a raw-material line (raw_material_id set) OR a sub-recipe
-- line (sub_recipe_id set), never both, never neither. This lets a recipe explode
-- into another recipe (e.g. "Masala Dosa" needs 1 portion of "Dosa Batter").
-- =============================================================================
alter table public.recipe_ingredients
  add column if not exists sub_recipe_id uuid references public.recipes (id) on delete restrict;

-- raw_material_id was NOT NULL (0001). Sub-recipe lines have no raw material, so
-- relax it to NULL; the XOR CHECK below guarantees integrity instead.
alter table public.recipe_ingredients
  alter column raw_material_id drop not null;

-- Exactly-one-of XOR: precisely one of {raw_material_id, sub_recipe_id} is set.
-- num_nonnulls is the cleanest way to express the constraint.
alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_kind_chk;
alter table public.recipe_ingredients
  add constraint recipe_ingredients_kind_chk
  check (num_nonnulls(raw_material_id, sub_recipe_id) = 1);

-- A recipe may not list itself as a sub-recipe (cheap one-level self-loop guard;
-- deeper cycles are blocked in app-side explosion with a visited-set).
alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_no_self_subrecipe_chk;
alter table public.recipe_ingredients
  add constraint recipe_ingredients_no_self_subrecipe_chk
  check (sub_recipe_id is null or sub_recipe_id <> recipe_id);

-- Replace the old unique(recipe_id, raw_material_id). A plain UNIQUE no longer
-- works because raw_material_id is now nullable AND we must also dedupe sub-recipe
-- lines. Two PARTIAL unique indexes cover both kinds independently:
--   * one raw-material line per (recipe, material)
--   * one sub-recipe line per (recipe, sub-recipe)
alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_recipe_id_raw_material_id_key;
drop index if exists public.recipe_ingredients_recipe_id_raw_material_id_key;

create unique index if not exists uq_recipe_ingredients_material
  on public.recipe_ingredients (recipe_id, raw_material_id)
  where raw_material_id is not null;

create unique index if not exists uq_recipe_ingredients_subrecipe
  on public.recipe_ingredients (recipe_id, sub_recipe_id)
  where sub_recipe_id is not null;

create index if not exists idx_recipe_ingredients_sub_recipe
  on public.recipe_ingredients (sub_recipe_id);

-- =============================================================================
-- SECTION 4: LOCATIONS — per-tenant POS webhook secret (HMAC / bearer auth).
-- Nullable: a location without an inbound POS integration simply has no secret.
-- Only admins may read/rotate it (locations_update already restricts to admins).
-- =============================================================================
alter table public.locations
  add column if not exists pos_webhook_secret text;

-- =============================================================================
-- SECTION 5: UNMAPPED_SALES — triage queue for POS line items whose pos_item_code
-- matches no recipe. The raw payload is retained so the line can be replayed once
-- the operator maps the code (resolved = true).
-- =============================================================================
create table if not exists public.unmapped_sales (
  id            uuid        primary key default gen_random_uuid(),
  location_id   uuid        not null references public.locations (id) on delete cascade,
  pos_item_code varchar(80),
  item_name     varchar(255),
  quantity      int         not null default 1 check (quantity > 0),
  raw_payload   jsonb,
  resolved      boolean     not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_unmapped_sales_location  on public.unmapped_sales (location_id);
-- Hot path: the triage UI lists OPEN items for the tenant, newest first.
create index if not exists idx_unmapped_sales_open
  on public.unmapped_sales (location_id, created_at desc)
  where resolved = false;

alter table public.unmapped_sales enable row level security;

drop policy if exists unmapped_sales_all on public.unmapped_sales;
create policy unmapped_sales_all on public.unmapped_sales
  for all to authenticated
  using (location_id = public.current_location_id())
  with check (location_id = public.current_location_id());

grant select, insert, update, delete on public.unmapped_sales to authenticated;

drop trigger if exists trg_set_location on public.unmapped_sales;
create trigger trg_set_location
  before insert on public.unmapped_sales
  for each row execute function public.set_location_id();

-- =============================================================================
-- SECTION 6: STOCK_COUNTS — manager physical counts; the "actual" leg of TvA.
--
--   system_qty  = theoretical on-hand snapshot at count time (app/view-derived).
--   actual_qty  = what the manager physically counted.
--   variance    = actual - system  (GENERATED STORED so it's queryable/indexable
--                 and can't drift). Negative = shrinkage/over-depletion.
--   par_level   = snapshot of the material's par at count time (for reorder UI).
--
-- unique(location, department, material, count_date): one count per material per
-- department per day; re-counting the same day UPSERTs.
-- =============================================================================
create table if not exists public.stock_counts (
  id              uuid          primary key default gen_random_uuid(),
  location_id     uuid          not null references public.locations (id) on delete cascade,
  department_id   int           not null references public.departments (id) on delete restrict,
  raw_material_id uuid          not null references public.raw_materials (id) on delete restrict,
  count_date      date          not null default current_date,
  system_qty      numeric(14,4) not null default 0,
  actual_qty      numeric(14,4) not null default 0,
  par_level       numeric(14,4) not null default 0,
  variance        numeric(14,4) generated always as (actual_qty - system_qty) stored,
  created_by      uuid          references public.profiles (id) on delete set null,
  created_at      timestamptz   not null default now(),
  unique (location_id, department_id, raw_material_id, count_date)
);

create index if not exists idx_stock_counts_location on public.stock_counts (location_id);
-- TvA dashboards filter by location + date, then by department.
create index if not exists idx_stock_counts_loc_date
  on public.stock_counts (location_id, count_date desc);
create index if not exists idx_stock_counts_material
  on public.stock_counts (raw_material_id);

alter table public.stock_counts enable row level security;

drop policy if exists stock_counts_all on public.stock_counts;
create policy stock_counts_all on public.stock_counts
  for all to authenticated
  using (location_id = public.current_location_id())
  with check (location_id = public.current_location_id());

grant select, insert, update, delete on public.stock_counts to authenticated;

drop trigger if exists trg_set_location on public.stock_counts;
create trigger trg_set_location
  before insert on public.stock_counts
  for each row execute function public.set_location_id();

-- =============================================================================
-- SECTION 7: THEORETICAL-STOCK HELPER VIEW.
--
-- live_stock already nets every ledger movement (including SALES_DEPLETION, which
-- is just another from_department outflow) into current_stock per
-- (location, raw_material, department). That IS the theoretical on-hand. We expose
-- a thin alias view `theoretical_stock` so app/explosion code has a stable,
-- intention-revealing name and so the "system_qty" snapshot has one canonical
-- source. security_invoker = on keeps RLS scoping with the caller.
-- =============================================================================
drop view if exists public.theoretical_stock;
create view public.theoretical_stock
with (security_invoker = on) as
select
  location_id,
  raw_material_id,
  raw_material_name,
  category,
  stock_unit,
  par_level,
  department_id,
  department_name,
  current_stock as theoretical_qty,
  below_par
from public.live_stock;

grant select on public.theoretical_stock to authenticated;

-- =============================================================================
-- SECTION 8: TvA VARIANCE VIEW — pair each manager count with the theoretical
-- snapshot it captured. Reads straight off stock_counts (system_qty is frozen at
-- count time), so it's stable and cheap. variance_value uses weighted_average_cost
-- to express shrinkage in ₹. security_invoker = on.
-- =============================================================================
drop view if exists public.stock_count_variance;
create view public.stock_count_variance
with (security_invoker = on) as
select
  sc.location_id,
  sc.count_date,
  sc.department_id,
  d.name                                   as department_name,
  sc.raw_material_id,
  rm.name                                  as raw_material_name,
  rm.stock_unit,
  sc.system_qty,
  sc.actual_qty,
  sc.variance,
  sc.par_level,
  coalesce(wac.weighted_avg_cost, 0)                      as unit_cost,
  round(sc.variance * coalesce(wac.weighted_avg_cost, 0), 2) as variance_value,
  (sc.actual_qty < sc.par_level)                         as below_par
from public.stock_counts sc
join public.raw_materials rm
  on rm.id = sc.raw_material_id
 and rm.location_id = sc.location_id
join public.departments d
  on d.id = sc.department_id
left join public.weighted_average_cost wac
  on wac.raw_material_id = sc.raw_material_id
 and wac.location_id     = sc.location_id;

grant select on public.stock_count_variance to authenticated;

-- =============================================================================
-- SECTION 9: REALTIME — surface the new triage + count tables to the app's
-- realtime subscriptions (inventory_ledger is already in the publication).
-- Guarded: add_table errors if the table is already a member, so we check first.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'unmapped_sales'
  ) then
    execute 'alter publication supabase_realtime add table public.unmapped_sales';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stock_counts'
  ) then
    execute 'alter publication supabase_realtime add table public.stock_counts';
  end if;
end $$;

-- =============================================================================
-- END OF PHASE 6 MIGRATION
-- =============================================================================
