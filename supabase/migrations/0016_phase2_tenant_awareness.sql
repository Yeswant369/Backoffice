-- =============================================================================
-- 0016 — PHASE 2: TENANT AWARENESS (security gate + cross-outlet roles + RLS)
--
-- Delivers the multi-tenant identity foundation:
--   A. SECURITY GATE (R0): stop users from rewriting their own authorization.
--      `profiles.roles` / `profiles.location_id` become un-writable by the
--      `authenticated` role (column-level grant) + a backstop trigger. Role and
--      location assignment flow ONLY through the service-role admin path.
--   B. New cross-outlet roles 5 = Area Manager, 6 = Owner, with DB helpers.
--   C. Read vs write scope split: current_location_ids() (broad, READ) vs
--      current_writable_location_ids() (narrow = home, WRITE). Cross-outlet
--      visibility is READ-ONLY (approved decision): owners/area-managers SEE
--      multiple outlets but WRITE only to their home location.
--   D. profile_locations join table (Area Manager's assigned outlets), writable
--      only via the service role (no self-grant escalation surface).
--   E. RLS rewrite: every operational `_all` policy becomes a broad `_select`
--      plus home-scoped insert/update/delete; admin-config policies become
--      org-manageable by Owners.
--
-- Roles 1-4 keep IDENTICAL (home-only) scope, so existing flows are unchanged.
-- RUN ORDER: 0000 -> 0014 -> 0015 -> 0016. Idempotent; safe to re-run.
-- =============================================================================

begin;

-- =============================================================================
-- A. SECURITY GATE — lock the authorization columns on profiles.
--    Postgres cannot subtract a column from a table-wide UPDATE grant, so we
--    drop the table-level UPDATE and re-grant only the self-editable column.
-- =============================================================================
revoke update on public.profiles from authenticated;
grant  update (full_name) on public.profiles to authenticated;

-- Backstop: even if UPDATE is re-granted broadly later, block roles/location_id
-- changes unless the caller is a trusted backend (service role → no auth.uid())
-- or already an admin. (Authenticated callers are stopped earlier by the grant.)
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.roles is distinct from old.roles)
     or (new.location_id is distinct from old.location_id) then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Not authorized to modify profile roles or location_id.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileges on public.profiles;
create trigger trg_guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- =============================================================================
-- B. ROLE HELPERS (SECURITY DEFINER → no RLS recursion).
--    6 = Owner (org-wide), 1 = Admin (location). can_manage_org() = either.
-- =============================================================================
create or replace function public.is_owner()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and 6 = any (roles));
$$;

create or replace function public.can_manage_org()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and (1 = any (roles) or 6 = any (roles))
  );
$$;

grant execute on function public.is_owner()      to authenticated;
grant execute on function public.can_manage_org() to authenticated;

-- =============================================================================
-- C. SCOPE HELPERS — READ set (broad) vs WRITE set (home only).
-- =============================================================================
-- READ scope: Owner → whole org; Area Manager → home + assigned outlets;
-- everyone else (Admin/Manager/Store/Kitchen) → home only (unchanged behavior).
create or replace function public.current_location_ids()
returns setof uuid language plpgsql security definer set search_path = public stable as $$
declare
  v_uid   uuid := auth.uid();
  v_roles int[];
  v_home  uuid;
  v_org   uuid;
begin
  select roles, location_id into v_roles, v_home
    from public.profiles where id = v_uid;
  if v_roles is null then
    return;                                   -- no profile → no locations
  end if;

  if 6 = any (v_roles) then                   -- Owner: entire organization
    select organization_id into v_org from public.locations where id = v_home;
    return query select id from public.locations where organization_id = v_org;
    return;
  end if;

  if 5 = any (v_roles) then                   -- Area Manager: home + assigned
    return query
      select v_home
      union
      select pl.location_id from public.profile_locations pl where pl.profile_id = v_uid;
    return;
  end if;

  return query select v_home;                 -- everyone else: home only
end;
$$;

-- WRITE scope: home only — cross-outlet access is READ-ONLY. This is the single
-- place to widen writes later if that decision ever changes.
create or replace function public.current_writable_location_ids()
returns setof uuid language sql security definer set search_path = public stable as $$
  select public.current_location_id();
$$;

grant execute on function public.current_location_ids()          to authenticated;
grant execute on function public.current_writable_location_ids() to authenticated;

-- =============================================================================
-- D. profile_locations — an Area Manager's assigned outlets. Readable by the
--    owner of the rows and by org managers; WRITABLE ONLY via the service role
--    (no INSERT/UPDATE/DELETE policy or grant → authenticated cannot self-grant).
-- =============================================================================
create table if not exists public.profile_locations (
  profile_id  uuid        not null references public.profiles (id) on delete cascade,
  location_id uuid        not null references public.locations (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, location_id)
);
create index if not exists idx_profile_locations_profile  on public.profile_locations (profile_id);
create index if not exists idx_profile_locations_location on public.profile_locations (location_id);

alter table public.profile_locations enable row level security;
drop policy if exists profile_locations_select on public.profile_locations;
create policy profile_locations_select on public.profile_locations
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (public.can_manage_org()
        and location_id in (select id from public.locations
                             where organization_id = public.current_org_id()))
  );

grant select on public.profile_locations to authenticated;  -- writes: service role only

-- =============================================================================
-- E. RLS REWRITE — broad READ, home-only WRITE.
-- =============================================================================

-- E1. Mutable operational tables: _all  ->  _select (broad) + insert/update/delete (home).
do $$
declare
  t text;
  mutable text[] := array[
    'departments', 'vendors', 'raw_materials', 'recipes', 'recipe_ingredients',
    'manual_sales_log', 'daily_sales_reconciliation', 'petty_cash_expenses',
    'unmapped_sales', 'stock_counts', 'pos_sales'
  ];
begin
  foreach t in array mutable loop
    execute format('drop policy if exists %I_all    on public.%I;', t, t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);

    execute format(
      'create policy %I_select on public.%I for select to authenticated
         using (location_id in (select public.current_location_ids()));', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated
         with check (location_id in (select public.current_writable_location_ids()));', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated
         using (location_id in (select public.current_writable_location_ids()))
         with check (location_id in (select public.current_writable_location_ids()));', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated
         using (location_id in (select public.current_writable_location_ids()));', t, t);
  end loop;
end $$;

-- E2. Append-only tables: broad SELECT, home-only INSERT (UPDATE/DELETE blocked by trigger).
drop policy if exists inventory_ledger_select on public.inventory_ledger;
create policy inventory_ledger_select on public.inventory_ledger
  for select to authenticated using (location_id in (select public.current_location_ids()));
drop policy if exists inventory_ledger_insert on public.inventory_ledger;
create policy inventory_ledger_insert on public.inventory_ledger
  for insert to authenticated with check (location_id in (select public.current_writable_location_ids()));

drop policy if exists vendor_payments_select on public.vendor_payments;
create policy vendor_payments_select on public.vendor_payments
  for select to authenticated using (location_id in (select public.current_location_ids()));
drop policy if exists vendor_payments_insert on public.vendor_payments;
create policy vendor_payments_insert on public.vendor_payments
  for insert to authenticated with check (location_id in (select public.current_writable_location_ids()));

-- E3. profiles: see colleagues across visible outlets; update only your own row
--     (roles/location_id are locked by the security gate above).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (location_id in (select public.current_location_ids()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- E4. locations: see all visible outlets; config editable by org managers.
drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations
  for select to authenticated using (id in (select public.current_location_ids()));
drop policy if exists locations_update on public.locations;
create policy locations_update on public.locations
  for update to authenticated
  using (id in (select public.current_location_ids()) and public.can_manage_org())
  with check (id in (select public.current_location_ids()) and public.can_manage_org());

-- E5. location_sheets: read across visible outlets; manage by org managers.
drop policy if exists location_sheets_select on public.location_sheets;
create policy location_sheets_select on public.location_sheets
  for select to authenticated using (location_id in (select public.current_location_ids()));
drop policy if exists location_sheets_admin on public.location_sheets;
create policy location_sheets_admin on public.location_sheets
  for all to authenticated
  using (location_id in (select public.current_location_ids()) and public.can_manage_org())
  with check (location_id in (select public.current_location_ids()) and public.can_manage_org());

-- organizations_select is unchanged (id = current_org_id()): one org per user.

-- =============================================================================
-- F. HARDENING (adversarial-review fixes)
-- =============================================================================
-- F1. locations: lock organization_id (tenant assignment) + id against
--     authenticated writes. Otherwise an Owner — whose can_manage_org() is true
--     and whose current_location_ids() spans the org — could UPDATE their home
--     location's organization_id to a VICTIM org; current_org_id() would then
--     resolve to the victim org on the next request, handing the Owner org-wide
--     READ of another tenant. Re-grant only the safe, app-edited columns.
revoke update on public.locations from authenticated;
grant  update (name, google_spreadsheet_id) on public.locations to authenticated;

-- F2. locations: drop pos_webhook_secret (a bearer credential) from the broad
--     SELECT — the broadened read scope must not hand an Area Manager/Owner the
--     POS secret of outlets they cannot operate. Only the service-role webhook
--     reads it. RLS can't filter columns, so use a column-level grant.
revoke select on public.locations from authenticated;
grant  select (id, organization_id, name, google_spreadsheet_id) on public.locations to authenticated;

-- F3. profiles: drop the inert INSERT/DELETE grants (no policy uses them; they
--     would become a self-provisioning hole the moment a permissive policy is
--     added). Profiles are created by the SECURITY DEFINER trigger and removed
--     via the auth.users cascade.
revoke insert, delete on public.profiles from authenticated;

-- F4. handle_new_user: NEVER provision a cross-outlet role (5/6) from signup
--     metadata — those are service-role-only grants. user_metadata is
--     client-writable, so a self-signup must not be able to mint an Owner.
--     (ALSO disable "allow new users to sign up" in Supabase Auth so that
--     user_metadata is only ever set by the service-role invite path.)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_roles    int[];
  v_location uuid;
begin
  begin
    select array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'roles')::int)
      into v_roles;
  exception when others then v_roles := null;
  end;
  -- Clamp to operational roles 1-4: 5/6 are never granted at signup.
  v_roles := array(select r from unnest(coalesce(v_roles, '{}'::int[])) r where r between 1 and 4);
  if array_length(v_roles, 1) is null then
    v_roles := array[3]::int[];
  end if;

  begin
    v_location := (new.raw_user_meta_data ->> 'location_id')::uuid;
  exception when others then v_location := null;
  end;

  if v_location is not null then
    insert into public.profiles (id, full_name, roles, location_id)
    values (new.id, new.raw_user_meta_data ->> 'full_name', v_roles, v_location)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

commit;

-- =============================================================================
-- END 0016 — PHASE 2 TENANT AWARENESS
-- =============================================================================
