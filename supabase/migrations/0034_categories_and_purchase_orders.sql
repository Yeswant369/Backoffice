-- =============================================================================
-- 0034 — Dynamic categories + Purchase Orders / Indents + stock value by category
--
-- A. `categories` — admin-managed lists (NOT enums): kind = material | vendor |
--    cuisine, unique name per outlet per kind. Items link via category_id while
--    KEEPING their existing text `category` column in sync (denormalised on
--    write) so every existing view/report/sheet keeps working unchanged.
-- B. raw_materials.material_type — the Ingredients | Operational top-level split.
-- C. vendors.category_id — vendor sector mapping (Foods / Maintenance …).
-- D. purchase_bills.photo_paths — MULTIPLE bill photos (array; the two legacy
--    single-photo columns remain valid).
-- E. purchase_orders + purchase_order_lines — unified staff→admin workflow for
--    external vendor POs AND internal kitchen indents:
--       PENDING → APPROVED → DISPATCHED (indent) / RECEIVED (vendor)
--                → REJECTED / CANCELLED
--    requested_qty vs approved_qty vs fulfilled_qty tracked per line.
-- F. dispatch_indent() RPC — ATOMIC: stock-guarded Store→department transfer
--    ledger rows + line fulfilment + status flip, in one transaction under an
--    advisory lock (two admins can't double-dispatch).
-- G. receive_purchase_order() RPC — ATOMIC: purchase bill (multi-photo) +
--    PURCHASE ledger rows (which auto-update last-price/WAC/live stock/dues)
--    + line fulfilment + status flip.
-- H. stock_value_by_category view — stock valued at the LATEST purchase rate,
--    grouped by category and material_type.
--
-- Idempotent. Run after 0033.
-- =============================================================================

-- A. categories
create table if not exists public.categories (
  id          uuid         primary key default gen_random_uuid(),
  location_id uuid         not null references public.locations (id) on delete cascade,
  kind        varchar(20)  not null check (kind in ('material', 'vendor', 'cuisine')),
  name        varchar(100) not null,
  created_at  timestamptz  not null default now(),
  constraint uq_categories unique (location_id, kind, name)
);
create index if not exists idx_categories_loc_kind on public.categories (location_id, kind);

alter table public.categories enable row level security;
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (location_id in (select public.current_location_ids()));
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (location_id in (select public.current_writable_location_ids()))
  with check (location_id in (select public.current_writable_location_ids()));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated
  using (location_id in (select public.current_writable_location_ids()));
grant select, insert, update, delete on public.categories to authenticated;

-- B/C. item ↔ category links (text columns stay, denormalised on write)
alter table public.raw_materials add column if not exists material_type varchar(20) not null default 'INGREDIENT'
  check (material_type in ('INGREDIENT', 'OPERATIONAL'));
alter table public.raw_materials add column if not exists category_id uuid references public.categories (id) on delete set null;
alter table public.vendors       add column if not exists category_id uuid references public.categories (id) on delete set null;

-- D. multiple bill photos
alter table public.purchase_bills add column if not exists photo_paths text[] not null default '{}';

-- E. purchase orders / indents
create table if not exists public.purchase_orders (
  id               uuid          primary key default gen_random_uuid(),
  location_id      uuid          not null references public.locations (id) on delete cascade,
  po_number        varchar(30)   not null,
  kind             varchar(10)   not null check (kind in ('VENDOR', 'INDENT')),
  status           varchar(12)   not null default 'PENDING'
                     check (status in ('PENDING','APPROVED','DISPATCHED','RECEIVED','REJECTED','CANCELLED')),
  vendor_id        uuid          references public.vendors (id) on delete restrict,      -- VENDOR kind
  to_department_id int           references public.departments (id) on delete restrict,  -- INDENT kind
  notes            text,
  expected_date    date,
  requested_by     uuid          references public.profiles (id) on delete set null,
  reviewed_by      uuid          references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz   not null default now(),
  constraint uq_purchase_orders_number unique (location_id, po_number),
  constraint po_kind_target_chk check (
    (kind = 'VENDOR' and vendor_id is not null) or
    (kind = 'INDENT' and to_department_id is not null)
  )
);
create index if not exists idx_purchase_orders_loc_status on public.purchase_orders (location_id, status);
create index if not exists idx_purchase_orders_loc_created on public.purchase_orders (location_id, created_at desc);

create table if not exists public.purchase_order_lines (
  id                  uuid          primary key default gen_random_uuid(),
  po_id               uuid          not null references public.purchase_orders (id) on delete cascade,
  location_id         uuid          not null references public.locations (id) on delete cascade,
  raw_material_id     uuid          not null references public.raw_materials (id) on delete restrict,
  requested_qty       numeric(14,4) not null check (requested_qty > 0),
  approved_qty        numeric(14,4) check (approved_qty >= 0),   -- admin-adjusted; null = as requested
  fulfilled_qty       numeric(14,4) not null default 0 check (fulfilled_qty >= 0),
  expected_unit_price numeric(14,4) check (expected_unit_price >= 0),
  constraint uq_po_line_material unique (po_id, raw_material_id)
);
create index if not exists idx_po_lines_po on public.purchase_order_lines (po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_lines'] loop
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated
                    using (location_id in (select public.current_location_ids()));', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated
                    with check (location_id in (select public.current_writable_location_ids()));', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated
                    using (location_id in (select public.current_writable_location_ids()))
                    with check (location_id in (select public.current_writable_location_ids()));', t, t);
  end loop;
end $$;
grant select, insert, update on public.purchase_orders, public.purchase_order_lines to authenticated;

-- F. ATOMIC indent dispatch (Store → requesting department)
create or replace function public.dispatch_indent(p_po_id uuid, p_lines jsonb)
returns void language plpgsql as $$
declare
  v_home  uuid := public.current_location_id();
  v_po    public.purchase_orders%rowtype;
  v_store int;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  e       jsonb;
  v_line  public.purchase_order_lines%rowtype;
  v_qty   numeric;
  v_have  numeric;
  v_name  text;
begin
  if v_home is null then raise exception 'NO_HOME: account has no home location'; end if;
  perform pg_advisory_xact_lock(hashtext('po:' || p_po_id::text));

  select * into v_po from public.purchase_orders
   where id = p_po_id and location_id = v_home for update;
  if not found then raise exception 'NOT_FOUND: order not in your location'; end if;
  if v_po.kind <> 'INDENT' then raise exception 'BAD_KIND: not an internal indent'; end if;
  if v_po.status not in ('PENDING','APPROVED') then
    raise exception 'BAD_STATUS: already % ', v_po.status;
  end if;

  select id into v_store from public.departments
   where lower(name) = 'store' and location_id = v_home limit 1;
  if v_store is null then raise exception 'NO_STORE: no "Store" department configured'; end if;
  if v_store = v_po.to_department_id then
    raise exception 'BAD_TARGET: indent target is the Store itself';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'NO_LINES: nothing to dispatch';
  end if;

  for e in select * from jsonb_array_elements(p_lines) loop
    select * into v_line from public.purchase_order_lines
     where id = (e->>'line_id')::uuid and po_id = p_po_id;
    if not found then raise exception 'BAD_LINE: line does not belong to this order'; end if;
    v_qty := (e->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 1e10 then
      raise exception 'BAD_QTY: dispatch quantities must be greater than zero';
    end if;

    -- Store on-hand for this material (derived inside the transaction).
    select coalesce(sum(case when to_department_id = v_store then quantity
                             when from_department_id = v_store then -quantity
                             else 0 end), 0)
      into v_have
      from public.inventory_ledger
     where location_id = v_home and raw_material_id = v_line.raw_material_id
       and (to_department_id = v_store or from_department_id = v_store);
    if v_qty > v_have then
      select name into v_name from public.raw_materials where id = v_line.raw_material_id;
      raise exception 'INSUFFICIENT: only % of % in the Store', v_have, coalesce(v_name, 'material');
    end if;

    insert into public.inventory_ledger
      (raw_material_id, from_department_id, to_department_id, type, quantity,
       transaction_date, location_id, created_by, source_ref)
    values
      (v_line.raw_material_id, v_store, v_po.to_department_id, 'INTER_DEPARTMENT_TRANSFER',
       v_qty, v_today, v_home, auth.uid(), 'po:' || v_po.po_number);

    update public.purchase_order_lines
       set fulfilled_qty = v_qty
     where id = v_line.id;
  end loop;

  update public.purchase_orders
     set status = 'DISPATCHED', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_po_id;
end $$;
revoke all on function public.dispatch_indent(uuid, jsonb) from public;
grant execute on function public.dispatch_indent(uuid, jsonb) to authenticated;

-- G. ATOMIC vendor-PO receiving (bill + ledger + fulfilment + status)
create or replace function public.receive_purchase_order(
  p_po_id uuid, p_invoice_no text, p_bill_date date, p_photo_paths text[], p_lines jsonb
) returns uuid language plpgsql as $$
declare
  v_home  uuid := public.current_location_id();
  v_po    public.purchase_orders%rowtype;
  v_store int;
  v_bill  uuid;
  v_appr  boolean;
  e       jsonb;
  v_line  public.purchase_order_lines%rowtype;
  v_qty   numeric;
  v_price numeric;
  p       text;
begin
  if v_home is null then raise exception 'NO_HOME: account has no home location'; end if;
  perform pg_advisory_xact_lock(hashtext('po:' || p_po_id::text));

  select * into v_po from public.purchase_orders
   where id = p_po_id and location_id = v_home for update;
  if not found then raise exception 'NOT_FOUND: order not in your location'; end if;
  if v_po.kind <> 'VENDOR' then raise exception 'BAD_KIND: not a vendor purchase order'; end if;
  if v_po.status not in ('PENDING','APPROVED') then
    raise exception 'BAD_STATUS: already %', v_po.status;
  end if;

  select approved into v_appr from public.vendors
   where id = v_po.vendor_id and location_id = v_home;
  if v_appr is distinct from true then
    raise exception 'VENDOR_NOT_APPROVED: approve the vendor first';
  end if;

  if p_bill_date is null
     or p_bill_date > (now() at time zone 'Asia/Kolkata')::date
     or p_bill_date < date '2000-01-01' then
    raise exception 'BAD_DATE: bill date looks wrong';
  end if;

  foreach p in array coalesce(p_photo_paths, '{}'::text[]) loop
    if p not like v_home::text || '/%' or p like '%..%' then
      raise exception 'BAD_PHOTO: invalid photo reference';
    end if;
  end loop;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'NO_LINES: nothing to receive';
  end if;

  select id into v_store from public.departments
   where lower(name) = 'store' and location_id = v_home limit 1;

  insert into public.purchase_bills
    (location_id, vendor_id, invoice_no, bill_date, photo_paths, created_by)
  values
    (v_home, v_po.vendor_id, nullif(btrim(coalesce(p_invoice_no, '')), ''), p_bill_date,
     coalesce(p_photo_paths, '{}'::text[]), auth.uid())
  returning id into v_bill;

  for e in select * from jsonb_array_elements(p_lines) loop
    select * into v_line from public.purchase_order_lines
     where id = (e->>'line_id')::uuid and po_id = p_po_id;
    if not found then raise exception 'BAD_LINE: line does not belong to this order'; end if;
    v_qty   := (e->>'qty')::numeric;
    v_price := (e->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 1e10 then
      raise exception 'BAD_QTY: received quantities must be greater than zero';
    end if;
    if v_price is null or v_price < 0 or v_price >= 1e10 then
      raise exception 'BAD_PRICE: unit prices must be valid non-negative numbers';
    end if;

    insert into public.inventory_ledger
      (raw_material_id, vendor_id, from_department_id, to_department_id, type,
       quantity, unit_price, transaction_date, bill_id, location_id, created_by)
    values
      (v_line.raw_material_id, v_po.vendor_id, null, v_store, 'PURCHASE',
       v_qty, v_price, p_bill_date, v_bill, v_home, auth.uid());

    update public.purchase_order_lines
       set fulfilled_qty = v_qty
     where id = v_line.id;
  end loop;

  update public.purchase_orders
     set status = 'RECEIVED', reviewed_by = coalesce(reviewed_by, auth.uid()),
         reviewed_at = coalesce(reviewed_at, now())
   where id = p_po_id;

  return v_bill;
end $$;
revoke all on function public.receive_purchase_order(uuid, text, date, text[], jsonb) from public;
grant execute on function public.receive_purchase_order(uuid, text, date, text[], jsonb) to authenticated;

-- H. Stock value by category at the LATEST purchase rate
create or replace view public.stock_value_by_category with (security_invoker = on) as
with latest_price as (
  select distinct on (location_id, raw_material_id)
         location_id, raw_material_id, unit_price
    from public.inventory_ledger
   where type = 'PURCHASE' and unit_price is not null
   order by location_id, raw_material_id,
            coalesce(transaction_date, (created_at at time zone 'Asia/Kolkata')::date) desc,
            created_at desc
),
totals as (
  select location_id, raw_material_id, sum(current_stock) as total_qty
    from public.live_stock
   group by location_id, raw_material_id
)
select rm.location_id,
       coalesce(rm.category, 'Uncategorised') as category,
       rm.material_type,
       count(*)                               as materials,
       round(sum(coalesce(t.total_qty, 0) * coalesce(lp.unit_price, 0))::numeric, 2) as stock_value
  from public.raw_materials rm
  left join totals t        on t.raw_material_id = rm.id and t.location_id = rm.location_id
  left join latest_price lp on lp.raw_material_id = rm.id and lp.location_id = rm.location_id
 group by rm.location_id, coalesce(rm.category, 'Uncategorised'), rm.material_type;

grant select on public.stock_value_by_category to authenticated;

-- =============================================================================
-- END 0034
-- =============================================================================
