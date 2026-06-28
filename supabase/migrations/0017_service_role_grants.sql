-- =============================================================================
-- 0017 — SERVICE ROLE GRANTS
--
-- This project has "Automatically expose new tables" DISABLED, so the
-- service_role never inherited privileges on the public schema (our migrations
-- granted only to `authenticated`). The platform console (createTenant /
-- addOutlet) and the owner Team actions use the service-role admin client for
-- privileged, cross-cutting writes — and were failing with
-- "permission denied for table organizations".
--
-- service_role is the trusted, server-only backend (used only with the secret
-- key, and it already bypasses RLS) — so grant it full access to the public
-- schema. No client (anon/authenticated) privilege changes here.
--
-- Idempotent. One-time platform migration (NOT per-customer). Run after 0016.
-- =============================================================================
grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute        on all functions in schema public to service_role;

-- Cover objects created later by the migration owner, too.
alter default privileges in schema public grant all     on tables    to service_role;
alter default privileges in schema public grant all     on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- =============================================================================
-- END 0017
-- =============================================================================
