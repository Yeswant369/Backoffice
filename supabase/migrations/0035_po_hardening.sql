-- =============================================================================
-- 0035 — PO/indent workflow hardening (review wf_d93dc311)
--
-- The 0034 tables had a broad UPDATE grant with location-only RLS, so any home
-- user could (via direct PostgREST) self-approve orders, rewrite quantities,
-- forge DISPATCHED/RECEIVED states, or — worst — flip a RECEIVED order back to
-- PENDING and re-run receive_purchase_order, double-posting into the
-- APPEND-ONLY ledger. Fixes, all enforced in the database:
--
-- A. STATE MACHINE triggers:
--    * purchase_orders: terminal states (DISPATCHED/RECEIVED/REJECTED/
--      CANCELLED) are immutable; PENDING→APPROVED/REJECTED requires roles 1|2;
--      →DISPATCHED/→RECEIVED only from inside the RPCs (transaction-local GUC);
--      identity columns (kind/vendor/department/number) never change.
--    * purchase_order_lines: fulfilled_qty changes only inside the RPCs;
--      approved_qty only while the parent is PENDING and by roles 1|2;
--      requested_qty/material immutable; new lines only on PENDING orders.
-- B. RPCs hardened:
--    * explicit role check (1|2|3) — SECURITY INVOKER grant alone let role 4
--      call them directly and mint reviewed_by provenance;
--    * require status = APPROVED (the review step is now mandatory);
--    * dispatch quantities capped at coalesce(approved_qty, requested_qty);
--      (over-RECEIVE stays allowed deliberately — bills reflect reality);
--    * duplicate line_id rejected;
--    * line material verified to belong to the home outlet.
--
-- Idempotent. Run after 0034.
-- =============================================================================

-- A1. order transitions
create or replace function public.guard_po_transitions()
returns trigger language plpgsql set search_path = public as $$
declare
  v_rpc      boolean := coalesce(current_setting('app.po_rpc', true) = new.id::text, false);
  v_reviewer boolean;
begin
  -- identity is immutable
  if new.kind <> old.kind or new.po_number <> old.po_number
     or new.vendor_id is distinct from old.vendor_id
     or new.to_department_id is distinct from old.to_department_id
     or new.location_id <> old.location_id
     or new.requested_by is distinct from old.requested_by then
    raise exception 'PO_IMMUTABLE: order identity cannot be changed';
  end if;

  if new.status = old.status then
    -- notes/expected_date edits only while still open
    if old.status not in ('PENDING','APPROVED') and
       (new.notes is distinct from old.notes or new.expected_date is distinct from old.expected_date) then
      raise exception 'PO_IMMUTABLE: processed orders cannot be edited';
    end if;
    return new;
  end if;

  -- terminal states never transition again
  if old.status in ('DISPATCHED','RECEIVED','REJECTED','CANCELLED') then
    raise exception 'PO_IMMUTABLE: % orders cannot change state', old.status;
  end if;

  -- service role (no auth.uid) is trusted backend
  if auth.uid() is null then return new; end if;

  select exists (
    select 1 from public.profiles
     where id = auth.uid() and roles && array[1,2]
  ) into v_reviewer;

  if new.status in ('APPROVED','REJECTED') then
    if old.status <> 'PENDING' then
      raise exception 'PO_TRANSITION: only pending orders can be reviewed';
    end if;
    if not v_reviewer then
      raise exception 'PO_ROLE: only admins/managers can review orders';
    end if;
    return new;
  end if;

  if new.status = 'CANCELLED' then
    return new; -- open→cancelled; requester-vs-manager scoping stays app-layer
  end if;

  if new.status in ('DISPATCHED','RECEIVED') then
    if not v_rpc then
      raise exception 'PO_TRANSITION: fulfilment states are set only by dispatch/receive';
    end if;
    return new;
  end if;

  raise exception 'PO_TRANSITION: illegal status change % → %', old.status, new.status;
end $$;

drop trigger if exists trg_guard_po_transitions on public.purchase_orders;
create trigger trg_guard_po_transitions
  before update on public.purchase_orders
  for each row execute function public.guard_po_transitions();

-- A2. line guards
create or replace function public.guard_po_line_updates()
returns trigger language plpgsql set search_path = public as $$
declare
  v_status text;
  v_rpc    boolean;
begin
  select status into v_status from public.purchase_orders where id = new.po_id;
  v_rpc := coalesce(current_setting('app.po_rpc', true) = new.po_id::text, false);

  if tg_op = 'INSERT' then
    if v_status is distinct from 'PENDING' then
      raise exception 'PO_LINES: lines can only be added to pending orders';
    end if;
    return new;
  end if;

  if new.po_id <> old.po_id or new.raw_material_id <> old.raw_material_id
     or new.location_id <> old.location_id
     or new.requested_qty <> old.requested_qty then
    raise exception 'PO_LINES: line identity/requested quantity cannot be changed';
  end if;
  if new.fulfilled_qty <> old.fulfilled_qty and not v_rpc then
    raise exception 'PO_LINES: fulfilment is recorded only by dispatch/receive';
  end if;
  if new.approved_qty is distinct from old.approved_qty then
    if v_status <> 'PENDING' then
      raise exception 'PO_LINES: quantities can only be adjusted while pending';
    end if;
    if auth.uid() is not null and not exists (
      select 1 from public.profiles where id = auth.uid() and roles && array[1,2]
    ) then
      raise exception 'PO_ROLE: only admins/managers can adjust quantities';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_po_lines on public.purchase_order_lines;
create trigger trg_guard_po_lines
  before insert or update on public.purchase_order_lines
  for each row execute function public.guard_po_line_updates();

-- B1. dispatch_indent v2
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
  v_cap   numeric;
  v_have  numeric;
  v_name  text;
  v_seen  uuid[] := '{}';
begin
  if v_home is null then raise exception 'NO_HOME: account has no home location'; end if;
  if auth.uid() is not null and not exists (
    select 1 from public.profiles where id = auth.uid() and roles && array[1,2,3]
  ) then
    raise exception 'PO_ROLE: only admins/managers/store can dispatch';
  end if;
  perform pg_advisory_xact_lock(hashtext('po:' || p_po_id::text));

  select * into v_po from public.purchase_orders
   where id = p_po_id and location_id = v_home for update;
  if not found then raise exception 'NOT_FOUND: order not in your location'; end if;
  if v_po.kind <> 'INDENT' then raise exception 'BAD_KIND: not an internal indent'; end if;
  if v_po.status <> 'APPROVED' then
    raise exception 'BAD_STATUS: order must be approved first (currently %)', v_po.status;
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

  perform set_config('app.po_rpc', p_po_id::text, true);

  for e in select * from jsonb_array_elements(p_lines) loop
    select * into v_line from public.purchase_order_lines
     where id = (e->>'line_id')::uuid and po_id = p_po_id;
    if not found then raise exception 'BAD_LINE: line does not belong to this order'; end if;
    if v_line.id = any(v_seen) then
      raise exception 'BAD_LINE: duplicate line in dispatch';
    end if;
    v_seen := v_seen || v_line.id;

    v_qty := (e->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 1e10 then
      raise exception 'BAD_QTY: dispatch quantities must be greater than zero';
    end if;
    v_cap := coalesce(v_line.approved_qty, v_line.requested_qty);
    if v_qty > v_cap then
      raise exception 'OVER_APPROVED: line allows at most % (approved/requested)', v_cap;
    end if;

    -- material must be the outlet's own (defense-in-depth vs crafted line rows)
    if not exists (select 1 from public.raw_materials
                    where id = v_line.raw_material_id and location_id = v_home) then
      raise exception 'BAD_LINE: material not in your location';
    end if;

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
     set status = 'DISPATCHED', reviewed_by = coalesce(reviewed_by, auth.uid()),
         reviewed_at = coalesce(reviewed_at, now())
   where id = p_po_id;
end $$;
revoke all on function public.dispatch_indent(uuid, jsonb) from public;
grant execute on function public.dispatch_indent(uuid, jsonb) to authenticated;

-- B2. receive_purchase_order v2
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
  v_seen  uuid[] := '{}';
  p       text;
begin
  if v_home is null then raise exception 'NO_HOME: account has no home location'; end if;
  if auth.uid() is not null and not exists (
    select 1 from public.profiles where id = auth.uid() and roles && array[1,2,3]
  ) then
    raise exception 'PO_ROLE: only admins/managers/store can receive';
  end if;
  perform pg_advisory_xact_lock(hashtext('po:' || p_po_id::text));

  select * into v_po from public.purchase_orders
   where id = p_po_id and location_id = v_home for update;
  if not found then raise exception 'NOT_FOUND: order not in your location'; end if;
  if v_po.kind <> 'VENDOR' then raise exception 'BAD_KIND: not a vendor purchase order'; end if;
  if v_po.status <> 'APPROVED' then
    raise exception 'BAD_STATUS: order must be approved first (currently %)', v_po.status;
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

  perform set_config('app.po_rpc', p_po_id::text, true);

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
    if v_line.id = any(v_seen) then
      raise exception 'BAD_LINE: duplicate line in receive';
    end if;
    v_seen := v_seen || v_line.id;

    v_qty   := (e->>'qty')::numeric;
    v_price := (e->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 1e10 then
      raise exception 'BAD_QTY: received quantities must be greater than zero';
    end if;
    if v_price is null or v_price < 0 or v_price >= 1e10 then
      raise exception 'BAD_PRICE: unit prices must be valid non-negative numbers';
    end if;
    if not exists (select 1 from public.raw_materials
                    where id = v_line.raw_material_id and location_id = v_home) then
      raise exception 'BAD_LINE: material not in your location';
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

-- =============================================================================
-- END 0035
-- =============================================================================
