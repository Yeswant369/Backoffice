-- =============================================================================
-- 0024 — Petpooja Get-Orders (PULL) integration + POS order analytics
--
-- The Get Orders API is a daily T-1 PULL: we call Petpooja with a per-outlet
-- restID (mapping code) and receive a day's orders. Each order's line items feed
-- the SAME recipe-explosion → SALES_DEPLETION / pos_sales pipeline as the live
-- webhook; each order's financial facts are captured in pos_orders for reporting
-- (daily sales, GST, payments, channel/Swiggy-Zomato, daypart, item profit).
--
-- Idempotent. Run after 0023.
-- =============================================================================

-- A. Per-location integration config.
alter table public.locations add column if not exists petpooja_rest_id    text;
alter table public.locations add column if not exists pos_commissions     jsonb not null default '{}'::jsonb;
alter table public.locations add column if not exists pos_last_synced_at   timestamptz;

-- Expose the non-secret POS config to the tenant (restID is a mapping code, not
-- a bearer credential — the creds live in env). Column grants are additive; the
-- writer is the SECURITY DEFINER set_pos_config below (no UPDATE grant needed).
grant select (petpooja_rest_id, pos_commissions, pos_last_synced_at) on public.locations to authenticated;

-- Two outlets must not claim the same Petpooja store — the shared company creds
-- + a duplicate restID would cross-ingest another restaurant's orders.
create unique index if not exists uq_locations_petpooja_rest_id
  on public.locations (petpooja_rest_id) where petpooja_rest_id is not null;

-- B. pos_orders — one row per Petpooja order (financial + channel facts).
create table if not exists public.pos_orders (
  id                 uuid        primary key default gen_random_uuid(),
  location_id        uuid        not null references public.locations (id) on delete cascade,
  order_key          text        not null,   -- ${order_date}#${orderID}: unique per location, stable across re-pulls
  pos_order_id       text,                    -- Order.orderID (daily counter)
  ref_id             text,
  online_order_id    text,
  order_type         text,                    -- Delivery / Dine In / Pickup
  channel            text,                    -- Order.order_from: Swiggy / Zomato / Dine In ...
  sub_order_type     text,                    -- Swiggy / Zomato ...
  payment_type       text,                    -- Online / Cash / Card ...
  custom_payment_type text,                   -- Swiggy / ...
  gross_amount       numeric(14,2) not null default 0,  -- core_total (pre-discount menu value)
  discount_amount    numeric(14,2) not null default 0,
  tax_amount         numeric(14,2) not null default 0,  -- GST (tax_total)
  round_off          numeric(14,2) not null default 0,
  net_amount         numeric(14,2) not null default 0,  -- total (final payable)
  status             text,                    -- Success / Cancelled ...
  sold_at            timestamptz,             -- created_on (IST)
  order_date         date,
  raw_payload        jsonb,                   -- full order object — lossless
  created_at         timestamptz not null default now(),
  constraint uq_pos_orders unique (location_id, order_key)
);
create index if not exists idx_pos_orders_loc_date   on public.pos_orders (location_id, order_date);
create index if not exists idx_pos_orders_loc_soldat on public.pos_orders (location_id, sold_at);

alter table public.pos_orders enable row level security;
drop policy if exists pos_orders_select on public.pos_orders;
create policy pos_orders_select on public.pos_orders for select to authenticated
  using (location_id in (select public.current_location_ids()));
-- Writes are service-role only (the cron/sync uses the admin client → bypasses RLS).
grant select on public.pos_orders to authenticated;

-- C. set_pos_config — admin-only writer for restID + commissions (avoids opening
-- a broad UPDATE policy on locations). SECURITY DEFINER, pinned to the caller's home.
create or replace function public.set_pos_config(p_rest_id text, p_commissions jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare home uuid;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and (1 = any(roles) or 6 = any(roles))
  ) then
    raise exception 'Only administrators can change POS configuration';
  end if;
  home := public.current_location_id();
  if home is null then raise exception 'No home location for this account'; end if;
  update public.locations
     set petpooja_rest_id = nullif(btrim(p_rest_id), ''),
         pos_commissions  = coalesce(p_commissions, '{}'::jsonb)
   where id = home;
end $$;
revoke all on function public.set_pos_config(text, jsonb) from public;
grant execute on function public.set_pos_config(text, jsonb) to authenticated;

-- =============================================================================
-- D. POS analytics views (security_invoker → inherit pos_orders RLS).
-- =============================================================================

-- Daily sales: gross, discount, GST, net, order count (successful orders only).
create or replace view public.pos_daily_sales with (security_invoker = on) as
select location_id, order_date,
       count(*)               as orders,
       sum(gross_amount)      as gross,
       sum(discount_amount)   as discount,
       sum(tax_amount)        as gst,
       sum(net_amount)        as net
  from public.pos_orders
 where status = 'Success'
 group by location_id, order_date;

-- Sales by channel (Swiggy / Zomato / Dine In ...) with payout net of the
-- per-platform commission % configured in locations.pos_commissions.
create or replace view public.pos_sales_by_channel with (security_invoker = on) as
select o.location_id, o.order_date,
       coalesce(nullif(o.channel, ''), o.order_type, 'Unknown') as channel,
       count(*)              as orders,
       sum(o.gross_amount)   as gross,
       sum(o.net_amount)     as net,
       sum(o.tax_amount)     as gst,
       round(sum(o.net_amount *
         (1 - coalesce(
                (l.pos_commissions ->> coalesce(nullif(o.channel, ''), o.order_type, 'Unknown'))::numeric,
                0) / 100)), 2)                                    as net_payout
  from public.pos_orders o
  join public.locations l on l.id = o.location_id
 where o.status = 'Success'
 group by o.location_id, o.order_date,
          coalesce(nullif(o.channel, ''), o.order_type, 'Unknown'),
          l.pos_commissions;

-- Daypart: bucket successful orders by IST hour of sale.
create or replace view public.pos_daypart with (security_invoker = on) as
select location_id, order_date,
       case when h < 12 then 'Morning'
            when h < 17 then 'Afternoon'
            when h < 22 then 'Evening'
            else 'Night' end as daypart,
       count(*)            as orders,
       sum(net_amount)     as net
  from (
    select location_id, order_date, net_amount,
           extract(hour from (sold_at at time zone 'Asia/Kolkata'))::int as h
      from public.pos_orders
     where status = 'Success' and sold_at is not null
  ) t
 group by location_id, order_date, daypart;

-- Item report: per recipe per day — qty, revenue, food cost, gross profit
-- (answers "which items make the most profit"). Joins line items to orders.
create or replace view public.pos_item_report with (security_invoker = on) as
select ps.location_id, po.order_date,
       ps.recipe_id, r.name as item_name, r.category,
       sum(ps.quantity)                                                as qty_sold,
       round(sum(ps.quantity) * r.selling_price, 2)                    as revenue,
       round(sum(ps.quantity) * public.recipe_cogs(ps.recipe_id), 2)   as food_cost,
       round(sum(ps.quantity) * (r.selling_price - public.recipe_cogs(ps.recipe_id)), 2) as gross_profit
  from public.pos_sales ps
  join public.pos_orders po
    on po.location_id = ps.location_id and po.order_key = ps.order_id
  join public.recipes r on r.id = ps.recipe_id
 where po.status = 'Success'
 group by ps.location_id, po.order_date, ps.recipe_id, r.name, r.category, r.selling_price;

grant select on public.pos_daily_sales, public.pos_sales_by_channel,
               public.pos_daypart, public.pos_item_report to authenticated;

-- =============================================================================
-- END 0024
-- =============================================================================
