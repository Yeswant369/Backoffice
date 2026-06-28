import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";
import { OPERATIONAL_ROLES } from "@/lib/roles";
import {
  ensureTab,
  getSheetsClient,
  getSpreadsheetUrl,
  listTabTitles,
  writeTab,
} from "@/lib/google/sheets";
import { resolveLocationSheet } from "@/lib/google/location";
import { syncProcurementTabs } from "@/lib/google/p2p-sync";
import { syncInhouseTabs } from "@/lib/google/inhouse-sync";
import {
  computeCosting,
  serializeTab,
  type MatrixRecipe,
} from "@/lib/google/recipe-matrix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TAB = "Uncategorized";

// Tab titles the sync owns. A recipe CATEGORY equal to one of these (categories
// are free text) would collide with that managed tab and clobber/garble it, so a
// colliding category is suffixed before it becomes a tab.
const RESERVED_TABS = new Set(
  [
    "Recipes", "Purchase Log", "Procurement Summary", "Vendors", "Vendor Master",
    "Dues Tracker", "Raw Materials", "Wastage", "Manual Sales", "Vendor Payments",
    "Daily Reconciliation", "Petty Cash", "Stock Counts",
  ].map((t) => t.toLowerCase()),
);
function safeRecipeTab(category: string): string {
  const name = category.trim() || DEFAULT_TAB;
  const lower = name.toLowerCase();
  return RESERVED_TABS.has(lower) || lower.startsWith("issues -")
    ? `${name} (Menu)`
    : name;
}

// Hard cap on coalescing re-runs so continuous concurrent saves can't make one
// request hold the lock forever (the sheet is eventually-consistent — any later
// save triggers a fresh sync that catches up).
const MAX_SYNC_RERUNS = 8;

interface RecipeIngredientJoin {
  quantity_needed: number;
  raw_materials: {
    id: string;
    name: string;
    brand: string | null;
    stock_unit: string;
  } | null;
}

interface RecipeJoin {
  id: string;
  name: string;
  pos_item_code: string | null;
  selling_price: number;
  yield_portions: number;
  overhead_percentage: number;
  category: string | null;
  recipe_ingredients: RecipeIngredientJoin[];
}

interface RecipeCostingRow {
  recipe_id: string;
  recipe_name: string;
  category: string | null;
  selling_price: number;
  cogs: number;
  margin_pct: number;
  food_cost_pct: number;
}

// Dedicated "Recipes" tab — the calculated costing summary from recipe_costing.
const RECIPES_TAB = "Recipes";
const RECIPES_HEADERS = [
  "Recipe Name",
  "Category",
  "POS Code",
  "Selling Price",
  "COGS",
  "Profit Margin (%)",
  "Food Cost (%)",
];

const num = (v: unknown) => Number(v ?? 0);

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type SheetsClient = ReturnType<typeof getSheetsClient>;
type LocSheet = { locationId: string; spreadsheetId: string };

/**
 * Read the location's data (pinned to its home id) and FULLY rewrite/append its
 * sheet tabs. Reads happen here — not before the lock — so every (re-)run mirrors
 * the latest committed state. Throws on any read error (caller maps to 500).
 */
async function runFullSync(
  supabase: ServerClient,
  sheets: SheetsClient,
  loc: LocSheet,
) {
  // Pin every read to the resolved HOME location (loc.locationId) — do NOT rely
  // on RLS read-scope, which spans the whole org for hybrid Admin+Owner users.
  const [recipeRes, wacRes, costingRes] = await Promise.all([
    supabase
      .from("recipes")
      .select(
        "id, name, pos_item_code, selling_price, yield_portions, overhead_percentage, category, recipe_ingredients!recipe_id ( quantity_needed, raw_materials ( id, name, brand, stock_unit ) )",
      )
      .eq("location_id", loc.locationId),
    supabase
      .from("weighted_average_cost")
      .select("raw_material_id, weighted_avg_cost")
      .eq("location_id", loc.locationId),
    // The calculated costing math (COGS / margin / food-cost %) per recipe.
    supabase
      .from("recipe_costing")
      .select(
        "recipe_id, recipe_name, category, selling_price, cogs, margin_pct, food_cost_pct",
      )
      .eq("location_id", loc.locationId),
  ]);

  if (recipeRes.error) throw new Error(recipeRes.error.message);
  // Guard the cost read too — a silent failure would render every recipe at ₹0
  // rates while still reporting success.
  if (wacRes.error) throw new Error(wacRes.error.message);
  // Guard the costing read: a silent failure would clear the Recipes tab down to
  // a bare header row while still reporting success.
  if (costingRes.error) throw new Error(costingRes.error.message);

  const wac = new Map<string, number>();
  for (const row of wacRes.data ?? []) {
    wac.set(row.raw_material_id, num(row.weighted_avg_cost));
  }

  // Build matrix recipes grouped by tab (category).
  const byTab = new Map<string, MatrixRecipe[]>();
  for (const r of (recipeRes.data ?? []) as unknown as RecipeJoin[]) {
    const ingredients = (r.recipe_ingredients ?? []).map((ri) => {
      const m = ri.raw_materials;
      const quantity = num(ri.quantity_needed);
      const rate = m ? (wac.get(m.id) ?? 0) : 0;
      return {
        material: m?.name ?? "Unknown",
        brand: m?.brand ?? "",
        quantity,
        unit: m?.stock_unit ?? "",
        rate,
        lineCost: quantity * rate,
      };
    });

    const yieldPortions = num(r.yield_portions) || 1;
    const sellingPrice = num(r.selling_price);
    const { batchCost, plateCost, margin, foodCostPct } = computeCosting({
      ingredients,
      yieldPortions,
      sellingPrice,
    });

    const recipe: MatrixRecipe = {
      name: r.name,
      ingredients,
      batchCost,
      yieldPortions,
      sellingPrice,
      plateCost,
      overheadPercentage: num(r.overhead_percentage),
      margin,
      foodCostPct,
    };

    const tab = safeRecipeTab(r.category ?? "");
    const list = byTab.get(tab) ?? [];
    list.push(recipe);
    byTab.set(tab, list);
  }

  const spreadsheetId = loc.spreadsheetId;
  const existing = await listTabTitles(sheets, spreadsheetId);

  // 1. Recipes (skipped silently when there are none).
  let recipeCount = 0;
  for (const [tab, recipes] of byTab) {
    await ensureTab(sheets, spreadsheetId, tab, existing);
    await writeTab(sheets, spreadsheetId, tab, serializeTab(tab, recipes));
    recipeCount += recipes.length;
  }

  // 1b. "Recipes" costing summary tab — auto-created, full rewrite from the
  // recipe_costing view (so COGS / margin % / food-cost % stay current).
  const posById = new Map(
    ((recipeRes.data ?? []) as unknown as RecipeJoin[]).map((r) => [
      r.id,
      r.pos_item_code,
    ]),
  );
  const recipeSummaryRows = (
    (costingRes.data ?? []) as unknown as RecipeCostingRow[]
  ).map((c) => [
    c.recipe_name ?? "",
    c.category ?? "",
    posById.get(c.recipe_id) ?? "",
    String(num(c.selling_price)),
    String(num(c.cogs)),
    String(num(c.margin_pct)),
    String(num(c.food_cost_pct)),
  ]);
  await ensureTab(sheets, spreadsheetId, RECIPES_TAB, existing);
  await writeTab(sheets, spreadsheetId, RECIPES_TAB, [
    RECIPES_HEADERS,
    ...recipeSummaryRows,
  ]);

  // 2. Procurement + dynamic department Issues tabs (append-safe mirror).
  const p2p = await syncProcurementTabs(
    supabase,
    sheets,
    spreadsheetId,
    existing,
    loc.locationId,
  );

  // 3. Mirror the remaining in-house entities (materials, wastage, manual sales,
  //    vendor payments, daily reconciliation, petty cash, stock counts).
  const inhouse = await syncInhouseTabs(
    supabase,
    sheets,
    spreadsheetId,
    existing,
    loc.locationId,
  );

  return {
    url: getSpreadsheetUrl(spreadsheetId),
    tabs: [
      ...byTab.keys(),
      RECIPES_TAB,
      "Purchase Log",
      "Procurement Summary",
      ...p2p.issueTabs,
      ...inhouse.tabs,
    ],
    recipeCount,
    purchasesSynced: p2p.purchases,
  };
}

export async function POST() {
  // Any operational role (1-4) may mirror their own location's data to Sheets —
  // floor staff syncing their own saves, not just admins. Read-only cross-outlet
  // roles (5/6) are excluded.
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => OPERATIONAL_ROLES.includes(r))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const supabase = await createClient();

  // Resolve THIS user's HOME location → its Google Sheet (tenant-safe).
  const loc = await resolveLocationSheet(supabase);
  if (!loc) {
    return NextResponse.json(
      { error: "No Google Sheet is configured for your location." },
      { status: 400 },
    );
  }

  try {
    const sheets = getSheetsClient();

    // Cross-client serialization: a coalescing distributed lock keyed by the
    // location (one spreadsheet per location). Two clients can't write the same
    // sheet at once (which would duplicate append rows / garble rewrites). If a
    // sync is already running, we flag "pending" and return — the holder re-runs
    // once it finishes, so the latest save is always mirrored.
    let result: Awaited<ReturnType<typeof runFullSync>> | null = null;
    for (let i = 0; i < MAX_SYNC_RERUNS; i++) {
      const { data: token, error: lockErr } =
        await supabase.rpc("acquire_sheet_lock");

      if (lockErr) {
        // Degrade to an UNLOCKED sync ONLY when the lock function isn't installed
        // yet (migration 0019 not applied) — fail-open beats not mirroring at all.
        // Any other acquire error is a real failure → surface it.
        if (lockErr.code === "PGRST202" || lockErr.code === "42883") {
          result = await runFullSync(supabase, sheets, loc);
          return NextResponse.json(result);
        }
        return NextResponse.json({ error: lockErr.message }, { status: 500 });
      }

      if (!token) {
        // A fresh sync holds the lock; we've marked it pending, so that holder
        // re-runs with our just-committed data. Return without blocking.
        return NextResponse.json({
          ok: true,
          coalesced: true,
          url: getSpreadsheetUrl(loc.spreadsheetId),
        });
      }

      let rerun = false;
      try {
        result = await runFullSync(supabase, sheets, loc);
      } finally {
        // Release is fenced by our token — a no-op if we were taken over as
        // stale, so we never clear another client's lock.
        const { data: r } = await supabase.rpc("release_sheet_lock", { tok: token });
        rerun = r === true; // a save arrived during our run → run once more
      }
      if (!rerun) break;
    }

    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to push to Google Sheets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
