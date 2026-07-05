-- =============================================================================
-- 0027 — Phase B: Purchase BILLS (multi-line entry, invoice no, photos) + daily view
--
-- A. purchase_bills — one row per supplier bill: vendor, invoice number, bill
--    photo + delivered-goods photo (Supabase Storage paths). The ledger stays
--    the append-only line-level source of truth; lines link via bill_id.
-- B. inventory_ledger.bill_id — groups a bill's lines (nullable: legacy rows
--    and single-line store entries have no bill).
-- C. daily_purchases view — purchases rolled up by business day.
-- D. Storage bucket `purchase-photos` (private) + per-location RLS policies.
--    Guarded so the migration also applies on plain Postgres (local verify).
--
-- Idempotent. Run after 0026.
-- =============================================================================

-- A. Bills
create table if not exists public.purchase_bills (
  id                  uuid        primary key default gen_random_uuid(),
  location_id         uuid        not null references public.locations (id) on delete cascade,
  vendor_id           uuid        not null references public.vendors (id) on delete restrict,
  invoice_no          varchar(80),
  bill_date           date,
  bill_photo_path     text,       -- storage path in bucket purchase-photos
  delivery_photo_path text,       -- photo of the delivered items
  created_by          uuid        references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists idx_purchase_bills_loc_date on public.purchase_bills (location_id, bill_date);
create index if not exists idx_purchase_bills_vendor   on public.purchase_bills (vendor_id);

alter table public.purchase_bills enable row level security;
drop policy if exists purchase_bills_select on public.purchase_bills;
create policy purchase_bills_select on public.purchase_bills for select to authenticated
  using (location_id in (select public.current_location_ids()));
drop policy if exists purchase_bills_insert on public.purchase_bills;
create policy purchase_bills_insert on public.purchase_bills for insert to authenticated
  with check (location_id in (select public.current_writable_location_ids()));
grant select, insert on public.purchase_bills to authenticated;

-- B. Ledger line → bill link
alter table public.inventory_ledger add column if not exists bill_id uuid references public.purchase_bills (id) on delete set null;
create index if not exists idx_inventory_ledger_bill on public.inventory_ledger (bill_id) where bill_id is not null;

-- C. Daily purchases (business-day rollup; IST fallback for undated legacy rows)
create or replace view public.daily_purchases with (security_invoker = on) as
select location_id,
       coalesce(transaction_date, (created_at at time zone 'Asia/Kolkata')::date) as day,
       count(*)                                          as lines,
       count(distinct bill_id)                           as bills,
       sum(quantity * coalesce(unit_price, 0))           as total
  from public.inventory_ledger
 where type = 'PURCHASE'
 group by location_id, coalesce(transaction_date, (created_at at time zone 'Asia/Kolkata')::date);
grant select on public.daily_purchases to authenticated;

-- D. Storage (Supabase only — no-op on plain Postgres)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('purchase-photos', 'purchase-photos', false, 10485760,  -- 10 MB
            array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif'])
    on conflict (id) do update
      set file_size_limit    = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    -- Per-location isolation: object paths are `<location_id>/<uuid>/<file>`;
    -- users may only touch objects under their HOME location's folder.
    drop policy if exists purchase_photos_insert on storage.objects;
    create policy purchase_photos_insert on storage.objects for insert to authenticated
      with check (
        bucket_id = 'purchase-photos'
        and (storage.foldername(name))[1] = (select public.current_location_id()::text)
      );
    drop policy if exists purchase_photos_select on storage.objects;
    create policy purchase_photos_select on storage.objects for select to authenticated
      using (
        bucket_id = 'purchase-photos'
        and (storage.foldername(name))[1] = (select public.current_location_id()::text)
      );
  end if;
end $$;

-- =============================================================================
-- END 0027
-- =============================================================================
