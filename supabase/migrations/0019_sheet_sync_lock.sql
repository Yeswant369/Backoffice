-- =============================================================================
-- 0019 — CROSS-CLIENT SHEET-SYNC LOCK (fenced coalescing distributed lock)
--
-- Two clients (different terminals/users at one outlet) saving at the same time
-- would each fire /api/sheets/push and race on the SAME spreadsheet — duplicate
-- appended rows, garbled clear-then-rewrite. This serializes sync per location.
--
-- Postgres SESSION advisory locks are unreliable on Supabase's transaction-mode
-- pooled connections, so we use a lock TABLE + two SECURITY DEFINER functions.
--
-- FENCED: acquire mints a per-acquisition `token`; release only clears the lock
-- when that token still matches. So if a slow holder is taken over as stale, its
-- later release is a safe no-op and can never clear a DIFFERENT client's lock.
--
-- Coalescing: if a fresh sync holds the lock, a second caller sets `pending` and
-- returns null; the holder re-runs once it finishes, mirroring the late data.
--
-- Stale timeout 300s ≈ an upper bound on a serverless function's lifetime, so a
-- crashed holder's lock is eventually reclaimable but a LIVE sync is not taken
-- over (keep this ≥ the platform's max function duration). Both functions derive
-- the location from current_location_id() (the caller's HOME) — a caller can
-- only ever lock their own outlet. Run after 0018. Idempotent.
-- =============================================================================

create table if not exists public.sheet_sync_locks (
  location_id uuid primary key references public.locations(id) on delete cascade,
  locked_at   timestamptz,
  locked_by   uuid,
  token       uuid,
  pending     boolean not null default false
);
alter table public.sheet_sync_locks add column if not exists token uuid;

alter table public.sheet_sync_locks enable row level security;
-- No policies on purpose: direct table access is denied for `authenticated`.
-- All access flows through the SECURITY DEFINER functions below (which run as the
-- table owner and scope strictly to the caller's home location).

-- Drop first so re-runs survive the boolean→uuid / arg-signature change.
drop function if exists public.acquire_sheet_lock();
drop function if exists public.release_sheet_lock();
drop function if exists public.release_sheet_lock(uuid);

-- Try to take the lock for the caller's home location. Returns a fencing TOKEN
-- when acquired; null when a fresh holder has it (in which case `pending` is
-- raised so that holder re-runs after it finishes) or there is no home location.
create or replace function public.acquire_sheet_lock()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  loc uuid := public.current_location_id();
  tok uuid := gen_random_uuid();
  got uuid;
begin
  if loc is null then
    return null;
  end if;

  insert into public.sheet_sync_locks (location_id, locked_at, locked_by, token, pending)
  values (loc, now(), auth.uid(), tok, false)
  on conflict (location_id) do update
    set locked_at = now(),
        locked_by = auth.uid(),
        token     = tok,
        pending   = false
    where sheet_sync_locks.locked_at is null
       or sheet_sync_locks.locked_at < now() - interval '300 seconds'
  returning token into got;

  if got is not null then
    return got; -- = tok; we hold the lock with this fencing token
  end if;

  -- Held by a fresh sync — flag that a re-run is needed once it releases.
  update public.sheet_sync_locks set pending = true where location_id = loc;
  return null;
end;
$$;

-- Release the caller's home-location lock IF the fencing token still matches
-- (we still own it). Returns whether a re-run is needed (a save coalesced onto
-- this run) and clears pending atomically. A no-op (returns false) if we were
-- taken over as stale — so we never clear another client's lock.
create or replace function public.release_sheet_lock(tok uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  loc uuid := public.current_location_id();
  was_pending boolean;
begin
  if loc is null then
    return false;
  end if;

  select pending into was_pending
    from public.sheet_sync_locks
   where location_id = loc and token = tok
   for update;

  if not found then
    return false; -- taken over (token changed) — do not touch the new holder
  end if;

  update public.sheet_sync_locks
     set locked_at = null, token = null, pending = false
   where location_id = loc and token = tok;

  return coalesce(was_pending, false);
end;
$$;

grant execute on function public.acquire_sheet_lock() to authenticated;
grant execute on function public.release_sheet_lock(uuid) to authenticated;

-- =============================================================================
-- END 0019
-- =============================================================================
