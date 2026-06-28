-- =============================================================================
-- Phase 5: Auto-deduct recipe ingredients on a manual sale
--
-- When a row is inserted into manual_sales_log, explode the dish's
-- recipe_ingredients, multiply each quantity_needed by quantity_sold, and post
-- MANUAL_SALE rows into inventory_ledger that deduct those raw materials from
-- the Kitchen.
--
-- Direction note: the live_stock view negates from_department_id, so a
-- deduction is `from_department_id = Kitchen` with a POSITIVE magnitude. (A
-- negative quantity here would double-invert and ADD stock on a sale.)
-- =============================================================================

create or replace function public.handle_manual_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kitchen_id int;
begin
  -- Resolve the Kitchen department (fall back to the Phase 1 seed id = 2).
  select id into v_kitchen_id
  from public.departments
  where lower(name) = 'kitchen'
  limit 1;
  v_kitchen_id := coalesce(v_kitchen_id, 2);

  insert into public.inventory_ledger (
    raw_material_id,
    from_department_id,
    to_department_id,
    type,
    quantity
  )
  select
    ri.raw_material_id,
    v_kitchen_id,                              -- deduct from Kitchen
    null,
    'MANUAL_SALE',
    ri.quantity_needed * new.quantity_sold     -- positive magnitude consumed
  from public.recipe_ingredients ri
  where ri.recipe_id = new.recipe_id;

  return new;
end;
$$;

drop trigger if exists on_manual_sale on public.manual_sales_log;
create trigger on_manual_sale
  after insert on public.manual_sales_log
  for each row execute function public.handle_manual_sale();
