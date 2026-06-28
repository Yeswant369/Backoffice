-- =============================================================================
-- RESET TEST DATA — wipe all operational rows, KEEP the tenant + your login.
--
-- PRESERVES (so you stay logged in & set up):
--   organizations, locations (incl. google_spreadsheet_id + pos_webhook_secret),
--   departments (the seeded Store/Kitchen/Bar/Bakery), profiles, location_sheets.
--
-- CLEARS (start every feature from scratch):
--   vendors, raw_materials, recipes, recipe_ingredients, inventory_ledger,
--   vendor_payments, manual_sales_log, daily_sales_reconciliation,
--   petty_cash_expenses, unmapped_sales, stock_counts, pos_sales.
--
-- WHY TRUNCATE: it's fast and — unlike DELETE — does NOT fire the append-only
-- prevent_mutation trigger (that trigger only fires on row UPDATE/DELETE), so the
-- immutable ledger clears cleanly. CASCADE clears FK-dependent rows in one shot.
-- It only cascades to tables that REFERENCE these (all listed), never up to the
-- preserved tenant tables.
--
-- HOW: paste into the Supabase SQL Editor and Run. Re-runnable any time.
-- =============================================================================
truncate table
  public.inventory_ledger,
  public.vendor_payments,
  public.vendors,
  public.raw_materials,
  public.recipes,
  public.recipe_ingredients,
  public.manual_sales_log,
  public.daily_sales_reconciliation,
  public.petty_cash_expenses,
  public.unmapped_sales,
  public.stock_counts,
  public.pos_sales
cascade;
