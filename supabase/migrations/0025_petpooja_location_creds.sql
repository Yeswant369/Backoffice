-- =============================================================================
-- 0025 — Per-location Petpooja credentials (self-serve vault)
--
-- Petpooja may issue creds PER restaurant (not company-wide). Store them per
-- outlet so each customer enters their OWN in Settings, with the env creds
-- (PETPOOJA_APP_*) as a company-level fallback. The creds are BEARER SECRETS:
-- deliberately NOT granted to `authenticated` (only the service-role sync/cron
-- reads them, exactly like locations.pos_webhook_secret). The UI writes them via
-- a SECURITY DEFINER setter and can only read a boolean "configured" status,
-- never the values.
--
-- Idempotent. Run after 0024.
-- =============================================================================

alter table public.locations add column if not exists petpooja_app_key      text;
alter table public.locations add column if not exists petpooja_app_secret   text;
alter table public.locations add column if not exists petpooja_access_token text;
-- NO grant to authenticated on these columns — service-role only (secrets).

-- Write-only setter (admin, home-pinned). A BLANK field keeps the existing value
-- (so saving other settings without re-typing creds never wipes them); pass a new
-- value to rotate.
create or replace function public.set_pos_creds(
  p_app_key text, p_app_secret text, p_access_token text)
returns void language plpgsql security definer set search_path = public as $$
declare home uuid;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and (1 = any(roles) or 6 = any(roles))
  ) then
    raise exception 'Only administrators can change POS credentials';
  end if;
  home := public.current_location_id();
  if home is null then raise exception 'No home location for this account'; end if;
  update public.locations set
    petpooja_app_key      = coalesce(nullif(btrim(p_app_key), ''),      petpooja_app_key),
    petpooja_app_secret   = coalesce(nullif(btrim(p_app_secret), ''),   petpooja_app_secret),
    petpooja_access_token = coalesce(nullif(btrim(p_access_token), ''), petpooja_access_token)
  where id = home;
end $$;
revoke all on function public.set_pos_creds(text, text, text) from public;
grant execute on function public.set_pos_creds(text, text, text) to authenticated;

-- Status only — does the caller's home outlet have all three creds? Never
-- exposes the secret values.
create or replace function public.pos_has_location_creds()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.locations
     where id = public.current_location_id()
       and petpooja_app_key is not null
       and petpooja_app_secret is not null
       and petpooja_access_token is not null
  );
$$;
revoke all on function public.pos_has_location_creds() from public;
grant execute on function public.pos_has_location_creds() to authenticated;

-- =============================================================================
-- END 0025
-- =============================================================================
