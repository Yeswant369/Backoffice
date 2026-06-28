-- =============================================================================
-- 0020 — VENDOR MASTER (full fields + auto stats) + DUES TRACKER module
--
-- A. Adds the remaining Vendor Master identity/bank/address fields to vendors.
-- B. vendor_master view — vendors joined to AUTO-derived stats (paid MTD/YTD,
--    outstanding, last payment, last purchase) so nothing is hand-typed.
-- C. dues table — money owed TO the restaurant (staff advances / IOUs).
-- D. dues_tracker view — AUTO outstanding / status / days-pending.
--
-- Views are security_invoker = on (location-scoped to the caller). Run after
-- 0019. Idempotent.
-- =============================================================================

-- A. Vendor identity / bank / address fields (stats stay DERIVED — see view B).
alter table public.vendors
  add column if not exists nature_of_supply varchar(255),
  add column if not exists alt_phone        varchar(20),
  add column if not exists category         varchar(100),
  add column if not exists upi_id           varchar(255),
  add column if not exists payment_terms    varchar(100),
  add column if not exists address          text,
  add column if not exists gstin            varchar(20),
  add column if not exists notes            text,
  add column if not exists dormancy_note    text;

-- B. vendor_master — the full master row with auto stats. No hand-typed numbers.
create or replace view public.vendor_master with (security_invoker = on) as
with pay as (
  select location_id, vendor_id,
         sum(amount_paid) filter (
           where payment_date >= date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date
             and payment_date <= (now() at time zone 'Asia/Kolkata')::date) as paid_mtd,
         sum(amount_paid) filter (
           where payment_date >= date_trunc('year', (now() at time zone 'Asia/Kolkata'))::date
             and payment_date <= (now() at time zone 'Asia/Kolkata')::date) as paid_ytd,
         max(payment_date) as last_payment
    from public.vendor_payments
   group by location_id, vendor_id
),
purch as (
  select location_id, vendor_id,
         max(coalesce(transaction_date::date, (created_at at time zone 'Asia/Kolkata')::date)) as last_purchase
    from public.inventory_ledger
   where type = 'PURCHASE' and vendor_id is not null
   group by location_id, vendor_id
)
select
  v.id, v.location_id, v.vendor_code, v.name, v.nature_of_supply, v.contact_person,
  v.phone, v.alt_phone, v.email, v.category,
  v.bank_name, v.account_number, v.ifsc_code, v.upi_id, v.payment_terms,
  v.address, v.gstin, v.notes,
  coalesce(pay.paid_mtd, 0)       as total_paid_mtd,
  coalesce(pay.paid_ytd, 0)       as total_paid_ytd,
  coalesce(vd.outstanding_due, 0) as outstanding,
  pay.last_payment,
  pu.last_purchase,
  v.created_at                    as first_added,
  v.status,
  v.dormancy_note
from public.vendors v
left join pay   on pay.vendor_id = v.id and pay.location_id = v.location_id
left join purch pu on pu.vendor_id = v.id and pu.location_id = v.location_id
left join public.vendor_dues vd on vd.vendor_id = v.id and vd.location_id = v.location_id;

grant select on public.vendor_master to authenticated;

-- C. Dues — money owed TO the restaurant (advances / IOUs). Mutable (settle later).
create table if not exists public.dues (
  id              uuid          primary key default gen_random_uuid(),
  location_id     uuid          not null references public.locations (id) on delete cascade,
  person_name     varchar(255)  not null,
  amount          numeric(14,2) not null check (amount > 0),
  reason          text,
  linked_date     date,
  date_settled    date,
  settled_amount  numeric(14,2) not null default 0 check (settled_amount >= 0),
  settled_mode    varchar(50),
  notes           text,
  created_at      timestamptz   not null default now()
);
create index if not exists idx_dues_location on public.dues (location_id);

alter table public.dues enable row level security;
drop policy if exists dues_select on public.dues;
create policy dues_select on public.dues for select to authenticated
  using (location_id in (select public.current_location_ids()));
drop policy if exists dues_insert on public.dues;
create policy dues_insert on public.dues for insert to authenticated
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists dues_update on public.dues;
create policy dues_update on public.dues for update to authenticated
  using (location_id in (select public.current_writable_location_ids()))
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists dues_delete on public.dues;
create policy dues_delete on public.dues for delete to authenticated
  using (location_id in (select public.current_writable_location_ids()));

grant select, insert, update, delete on public.dues to authenticated;

-- D. dues_tracker — auto outstanding / status / days-pending.
create or replace view public.dues_tracker with (security_invoker = on) as
select
  id, location_id,
  created_at::date as date_created,
  person_name, amount, reason, linked_date, date_settled,
  settled_amount, settled_mode, notes,
  greatest(amount - settled_amount, 0) as outstanding,
  case when settled_amount >= amount then 'SETTLED'
       when settled_amount > 0       then 'PARTIAL'
       else 'PENDING' end as status,
  case when settled_amount >= amount then null
       else ((now() at time zone 'Asia/Kolkata')::date - coalesce(linked_date, created_at::date)) end as days_pending
from public.dues;

grant select on public.dues_tracker to authenticated;

-- =============================================================================
-- END 0020
-- =============================================================================
