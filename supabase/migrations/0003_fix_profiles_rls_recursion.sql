-- =============================================================================
-- FIX: infinite recursion in profiles_select RLS policy
--
-- The Phase 1 policy referenced `profiles` inside its own USING clause, so
-- evaluating it re-triggered the same policy → Postgres raises
-- "infinite recursion detected in policy for relation profiles", and EVERY
-- authenticated SELECT on profiles fails. That made role lookups return empty,
-- routing valid users to /dashboard/no-access.
--
-- Fix: move the admin check into a SECURITY DEFINER function. Running as the
-- function owner (postgres, the table owner) bypasses RLS, so the inner read of
-- `profiles` does NOT re-enter the policy. No recursion.
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and 1 = any (roles)
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- Recreate the SELECT policy without the self-referencing subquery.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()        -- a user can always read their own profile
    or public.is_admin()   -- admins can read everyone (no recursion)
  );
