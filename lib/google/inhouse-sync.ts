import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureTab, writeTab } from "./sheets";

type Sheets = Parameters<typeof ensureTab>[0];
type NameRef = { name: string | null } | null;

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => String(Number(v ?? 0));
const day = (v: unknown) => s(v).slice(0, 10);

async function mirror(
  sheets: Sheets,
  spreadsheetId: string,
  existing: string[],
  tab: string,
  headers: string[],
  rows: string[][],
) {
  await ensureTab(sheets, spreadsheetId, tab, existing);
  await writeTab(sheets, spreadsheetId, tab, [headers, ...rows]);
}

/**
 * Mirror the previously-siloed in-house entities to their own sheet tabs. Each
 * is a FULL rewrite from the DB → idempotent and always reflects edits/deletes
 * (no row-count drift). Every read is pinned to locationId (the caller's home
 * location) — NOT RLS read-scope, which spans the org for hybrid Admin+Owner
 * roles and would otherwise bleed all outlets' data into one sheet.
 */
export async function syncInhouseTabs(
  supabase: SupabaseClient,
  sheets: Sheets,
  spreadsheetId: string,
  existing: string[],
  locationId: string,
): Promise<{ tabs: string[] }> {
  const tabs: string[] = [];

  // Raw Materials master
  const { data: mats } = await supabase
    .from("raw_materials")
    .select(
      "name, code, brand, purchase_unit, stock_unit, conversion_factor, par_level, category, vendors ( name )",
    )
    .eq("location_id", locationId)
    .order("name");
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Raw Materials",
    ["Code", "Name", "Brand", "Purchase Unit", "Stock Unit", "Conversion", "PAR", "Category", "Vendor"],
    ((mats ?? []) as unknown as Array<{
      name: string;
      code: string | null;
      brand: string | null;
      purchase_unit: string;
      stock_unit: string;
      conversion_factor: number;
      par_level: number;
      category: string | null;
      vendors: NameRef;
    }>).map((m) => [
      s(m.code),
      s(m.name),
      s(m.brand),
      s(m.purchase_unit),
      s(m.stock_unit),
      n(m.conversion_factor),
      n(m.par_level),
      s(m.category),
      s(m.vendors?.name),
    ]),
  );
  tabs.push("Raw Materials");

  // Wastage (WASTAGE ledger)
  const { data: waste } = await supabase
    .from("inventory_ledger")
    .select(
      "created_at, transaction_date, quantity, wastage_reason, raw_materials ( name ), from_department:departments!from_department_id ( name )",
    )
    .eq("type", "WASTAGE")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Wastage",
    ["Date", "Material", "Qty", "Reason", "Department"],
    ((waste ?? []) as unknown as Array<{
      created_at: string;
      transaction_date: string | null;
      quantity: number;
      wastage_reason: string | null;
      raw_materials: NameRef;
      from_department: NameRef;
    }>).map((w) => [
      day(w.transaction_date ?? w.created_at),
      s(w.raw_materials?.name),
      n(w.quantity),
      s(w.wastage_reason),
      s(w.from_department?.name),
    ]),
  );
  tabs.push("Wastage");

  // Manual Sales
  const { data: sales } = await supabase
    .from("manual_sales_log")
    .select("sale_date, quantity_sold, recipes ( name )")
    .eq("location_id", locationId)
    .order("sale_date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Manual Sales",
    ["Date", "Recipe", "Qty Sold"],
    ((sales ?? []) as unknown as Array<{
      sale_date: string;
      quantity_sold: number;
      recipes: NameRef;
    }>).map((x) => [s(x.sale_date), s(x.recipes?.name), n(x.quantity_sold)]),
  );
  tabs.push("Manual Sales");

  // Vendor Payments
  const { data: pays } = await supabase
    .from("vendor_payments")
    .select("payment_date, amount_paid, payment_mode, reference_utr, vendors ( name )")
    .eq("location_id", locationId)
    .order("payment_date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Vendor Payments",
    ["Date", "Vendor", "Amount", "Mode", "Reference"],
    ((pays ?? []) as unknown as Array<{
      payment_date: string;
      amount_paid: number;
      payment_mode: string;
      reference_utr: string | null;
      vendors: NameRef;
    }>).map((p) => [
      s(p.payment_date),
      s(p.vendors?.name),
      n(p.amount_paid),
      s(p.payment_mode),
      s(p.reference_utr),
    ]),
  );
  tabs.push("Vendor Payments");

  // Daily Reconciliation
  const { data: recon } = await supabase
    .from("daily_sales_reconciliation")
    .select(
      "date, dine_in_gross, zomato_gross, swiggy_gross, cash_collected, upi_collected, card_collected, aggregator_commissions, actual_bank_deposit",
    )
    .eq("location_id", locationId)
    .order("date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Daily Reconciliation",
    ["Date", "Dine-in", "Zomato", "Swiggy", "Cash", "UPI", "Card", "Commissions", "Bank Deposit"],
    ((recon ?? []) as unknown as Array<Record<string, unknown>>).map((r) => [
      s(r.date),
      n(r.dine_in_gross),
      n(r.zomato_gross),
      n(r.swiggy_gross),
      n(r.cash_collected),
      n(r.upi_collected),
      n(r.card_collected),
      n(r.aggregator_commissions),
      n(r.actual_bank_deposit),
    ]),
  );
  tabs.push("Daily Reconciliation");

  // Petty Cash
  const { data: petty } = await supabase
    .from("petty_cash_expenses")
    .select("date, category, amount, description")
    .eq("location_id", locationId)
    .order("date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Petty Cash",
    ["Date", "Category", "Amount", "Description"],
    ((petty ?? []) as unknown as Array<{
      date: string;
      category: string;
      amount: number;
      description: string | null;
    }>).map((p) => [s(p.date), s(p.category), n(p.amount), s(p.description)]),
  );
  tabs.push("Petty Cash");

  // Stock Counts
  const { data: counts } = await supabase
    .from("stock_counts")
    .select(
      "count_date, system_qty, actual_qty, variance, par_level, departments ( name ), raw_materials ( name )",
    )
    .eq("location_id", locationId)
    .order("count_date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Stock Counts",
    ["Date", "Department", "Material", "System", "Actual", "Variance", "PAR"],
    ((counts ?? []) as unknown as Array<{
      count_date: string;
      system_qty: number;
      actual_qty: number;
      variance: number;
      par_level: number;
      departments: NameRef;
      raw_materials: NameRef;
    }>).map((c) => [
      s(c.count_date),
      s(c.departments?.name),
      s(c.raw_materials?.name),
      n(c.system_qty),
      n(c.actual_qty),
      n(c.variance),
      n(c.par_level),
    ]),
  );
  tabs.push("Stock Counts");

  // Vendor Master — full row + AUTO stats (paid MTD/YTD, outstanding, last
  // payment/purchase) from the vendor_master view. Nothing hand-typed.
  const { data: vmaster } = await supabase
    .from("vendor_master")
    .select("*")
    .eq("location_id", locationId)
    .order("vendor_code");
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Vendor Master",
    [
      "Vendor ID", "Vendor Name", "Nature of Supply", "Contact Person", "Phone",
      "Alt Phone", "Email", "Category", "Bank Name", "Account Number", "IFSC",
      "UPI ID", "Payment Terms", "Address", "GSTIN", "Notes", "Total Paid MTD",
      "Total Paid YTD", "Outstanding", "Last Payment", "Status", "Last Purchase",
      "First Added", "Dormancy Note",
    ],
    ((vmaster ?? []) as unknown as Array<Record<string, unknown>>).map((v) => [
      s(v.vendor_code), s(v.name), s(v.nature_of_supply), s(v.contact_person),
      s(v.phone), s(v.alt_phone), s(v.email), s(v.category), s(v.bank_name),
      s(v.account_number), s(v.ifsc_code), s(v.upi_id), s(v.payment_terms),
      s(v.address), s(v.gstin), s(v.notes), n(v.total_paid_mtd),
      n(v.total_paid_ytd), n(v.outstanding), day(v.last_payment), s(v.status),
      day(v.last_purchase), day(v.first_added), s(v.dormancy_note),
    ]),
  );
  tabs.push("Vendor Master");

  // Dues Tracker — money owed TO the restaurant; AUTO outstanding/status/days.
  const { data: duesRows } = await supabase
    .from("dues_tracker")
    .select("*")
    .eq("location_id", locationId)
    .order("date_created", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Dues Tracker",
    [
      "Date Created", "Person Name", "Amount", "Reason", "Linked Date",
      "Date Settled", "Settled Amt", "Settled Mode", "Outstanding", "Status",
      "Days Pending", "Notes",
    ],
    ((duesRows ?? []) as unknown as Array<Record<string, unknown>>).map((d) => [
      s(d.date_created), s(d.person_name), n(d.amount), s(d.reason),
      s(d.linked_date), s(d.date_settled), n(d.settled_amount), s(d.settled_mode),
      n(d.outstanding), s(d.status),
      d.days_pending == null ? "—" : String(d.days_pending), s(d.notes),
    ]),
  );
  tabs.push("Dues Tracker");

  // Kitchen Production — prepared/sold/wasted per dish per department + variance.
  const { data: prod } = await supabase
    .from("kitchen_production_view")
    .select(
      "production_date, department_name, recipe_name, prepared_qty, sold_qty, wastage_qty, variance, unit_cost, wastage_cost, staff_meals_qty, closing_qty",
    )
    .eq("location_id", locationId)
    .order("production_date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Kitchen Production",
    ["Date", "Department", "Item", "Prepared", "Sold", "Wasted", "Variance", "Unit Cost", "Wastage Cost", "Staff Meals", "Closing"],
    ((prod ?? []) as unknown as Array<Record<string, unknown>>).map((p) => [
      day(p.production_date),
      s(p.department_name),
      s(p.recipe_name),
      n(p.prepared_qty),
      n(p.sold_qty),
      n(p.wastage_qty),
      n(p.variance),
      n(p.unit_cost),
      n(p.wastage_cost),
      n(p.staff_meals_qty),
      p.closing_qty == null ? "" : n(p.closing_qty),
    ]),
  );
  tabs.push("Kitchen Production");

  // Sub-Recipe Production — day ledger with carry-forward opening + auto-used.
  const { data: subProd } = await supabase
    .from("sub_recipe_daily")
    .select(
      "production_date, recipe_name, opening_qty, made_qty, available_qty, used_qty, waste_qty, closing_qty, variance_qty, unit_cost",
    )
    .eq("location_id", locationId)
    .order("production_date", { ascending: false })
    .order("recipe_name");
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Sub-Recipe Production",
    ["Date", "Sub-Recipe", "Opening", "Made", "Available", "Used", "Waste", "Closing", "Variance", "Unit Cost"],
    ((subProd ?? []) as unknown as Array<Record<string, unknown>>).map((p) => [
      day(p.production_date),
      s(p.recipe_name),
      n(p.opening_qty),
      n(p.made_qty),
      n(p.available_qty),
      n(p.used_qty),
      n(p.waste_qty),
      p.closing_qty == null ? "" : n(p.closing_qty),
      p.variance_qty == null ? "" : n(p.variance_qty),
      n(p.unit_cost),
    ]),
  );
  tabs.push("Sub-Recipe Production");

  // Department P&L — raw issued-in cost vs sale revenue vs item wastage, per dept.
  const { data: dpl } = await supabase
    .from("department_pl")
    .select("department_name, sale_value, items_sold, issued_cost, item_wastage_cost")
    .eq("location_id", locationId)
    .order("sale_value", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Department P&L",
    ["Department", "Sale Value", "Items Sold", "Raw Issued (cost)", "Item Wastage", "Net"],
    ((dpl ?? []) as unknown as Array<Record<string, unknown>>).map((d) => {
      const net =
        Number(d.sale_value ?? 0) -
        Number(d.issued_cost ?? 0) -
        Number(d.item_wastage_cost ?? 0);
      return [
        s(d.department_name) || "Unassigned",
        n(d.sale_value),
        n(d.items_sold),
        n(d.issued_cost),
        n(d.item_wastage_cost),
        net.toFixed(2),
      ];
    }),
  );
  tabs.push("Department P&L");

  // Profit & Loss (daily) — theoretical vs actual COGS + gross profit.
  const { data: pl } = await supabase
    .from("pl_daily")
    .select(
      "pl_date, revenue, theoretical_cogs, wastage_cost, variance_cost, actual_cogs",
    )
    .eq("location_id", locationId)
    .order("pl_date", { ascending: false });
  await mirror(
    sheets,
    spreadsheetId,
    existing,
    "Profit & Loss",
    ["Date", "Revenue", "Theoretical COGS", "Wastage", "Variance", "Actual COGS", "Gross Profit", "Food Cost %"],
    ((pl ?? []) as unknown as Array<Record<string, unknown>>).map((p) => {
      const rev = Number(p.revenue ?? 0);
      const act = Number(p.actual_cogs ?? 0);
      return [
        day(p.pl_date),
        n(p.revenue),
        n(p.theoretical_cogs),
        n(p.wastage_cost),
        n(p.variance_cost),
        n(p.actual_cogs),
        (rev - act).toFixed(2),
        rev > 0 ? `${((act / rev) * 100).toFixed(1)}%` : "—",
      ];
    }),
  );
  tabs.push("Profit & Loss");

  return { tabs };
}
