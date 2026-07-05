-- =============================================================================
-- 0026 — Raw material CODES (Phase A foundation)
--
-- Gives every raw material a short human code (like vendors' vendor_code):
-- shown in pickers/autosuggest, live stock, the material profile, and synced
-- to the sheet. Existing materials are backfilled RM-0001… per location (by
-- creation order); new materials get a code from the app (auto or typed).
--
-- Idempotent. Run after 0025.
-- =============================================================================

alter table public.raw_materials add column if not exists code varchar(40);

-- Backfill only rows still missing a code, numbering AFTER the highest already
-- assigned RM-#### in that location so a re-run (or partial manual assignment)
-- never collides.
with base as (
  select location_id,
         coalesce(max(nullif(regexp_replace(code, '^RM-0*', ''), '')::bigint), 0) as seed
    from public.raw_materials
   where code ~ '^RM-[0-9]{1,12}$'  -- bounded: no ::bigint overflow on absurd codes
   group by location_id
),
numbered as (
  select rm.id,
         'RM-' || lpad(
           (coalesce(b.seed, 0)
             + row_number() over (partition by rm.location_id order by rm.created_at, rm.id))::text,
           greatest(4, length((coalesce(b.seed, 0)
             + row_number() over (partition by rm.location_id order by rm.created_at, rm.id))::text)),
           '0') as gen
    from public.raw_materials rm
    left join base b on b.location_id = rm.location_id
   where rm.code is null
)
update public.raw_materials rm
   set code = n.gen
  from numbered n
 where rm.id = n.id;

-- One code per outlet (nullable-safe partial index).
create unique index if not exists uq_raw_materials_location_code
  on public.raw_materials (location_id, code) where code is not null;

-- =============================================================================
-- END 0026
-- =============================================================================
