-- =============================================================================
-- Multi-sheet registry: one restaurant (location) can sync several Google
-- Sheets, each identified by a `purpose` (e.g. 'recipes', 'vendors', 'sales').
-- The service-account credentials stay in env and are reused for every sheet;
-- only the spreadsheet *id* lives here. Share each new sheet with the bot.
--
-- Requires Phase 5 (0007): uses current_location_id() and is_admin().
-- =============================================================================

create table if not exists public.location_sheets (
  id                    uuid        primary key default gen_random_uuid(),
  location_id           uuid        not null references public.locations (id) on delete cascade,
  purpose               varchar(50) not null,
  google_spreadsheet_id text        not null,
  created_at            timestamptz not null default now(),
  unique (location_id, purpose)
);

create index if not exists idx_location_sheets_location
  on public.location_sheets (location_id);

alter table public.location_sheets enable row level security;

grant select, insert, update, delete on public.location_sheets to authenticated;

-- Anyone in the location may read its sheet config; only admins may change it.
drop policy if exists location_sheets_select on public.location_sheets;
create policy location_sheets_select on public.location_sheets
  for select to authenticated
  using (location_id = public.current_location_id());

drop policy if exists location_sheets_admin on public.location_sheets;
create policy location_sheets_admin on public.location_sheets
  for all to authenticated
  using (location_id = public.current_location_id() and public.is_admin())
  with check (location_id = public.current_location_id() and public.is_admin());

-- Register the existing recipe sheet (from locations) so everything lives in one
-- place going forward. Idempotent.
insert into public.location_sheets (location_id, purpose, google_spreadsheet_id)
select id, 'recipes', google_spreadsheet_id
from public.locations
where google_spreadsheet_id is not null
on conflict (location_id, purpose) do nothing;
