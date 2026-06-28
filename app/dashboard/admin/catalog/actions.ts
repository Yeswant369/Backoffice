"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface CatalogState {
  error?: string;
  success?: string;
  /** Unique per success — lets forms remount/clear without a setState effect. */
  token?: string;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

async function guard(): Promise<string | null> {
  return (await isAdmin()) ? null : "Only administrators can manage the catalog.";
}

/**
 * Connect (register) a Google Sheet to a workspace purpose for the caller's
 * location. Accepts a raw spreadsheet id or a full sheet URL.
 */
export async function saveWorkspaceSheet(
  purpose: string,
  spreadsheetIdOrUrl: string,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const raw = spreadsheetIdOrUrl.trim();
  const urlMatch = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = urlMatch ? urlMatch[1] : raw;
  if (!spreadsheetId) return { error: "Enter a spreadsheet ID or URL." };
  if (!purpose.trim()) return { error: "Missing workspace purpose." };

  const supabase = await createClient();
  const { data: loc } = await supabase
    .from("locations")
    .select("id")
    .maybeSingle();
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { error } = await supabase.from("location_sheets").upsert(
    {
      location_id: loc.id,
      purpose: purpose.trim(),
      google_spreadsheet_id: spreadsheetId,
    },
    { onConflict: "location_id,purpose" },
  );
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/catalog");
  return { success: "Workspace sheet connected.", token: crypto.randomUUID() };
}

// --- Grid → DB imports -------------------------------------------------------

interface GridPayload {
  headers: string[];
  rows: string[][];
  logDate: string;
}

const normH = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find the column index whose header matches any candidate (fuzzy). */
function colIndex(headers: string[], candidates: string[]): number {
  const want = new Set(candidates.map(normH));
  return headers.findIndex((h) => want.has(normH(h)));
}

async function currentLocationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  // Home location via rpc — RLS read-scope spans the org for hybrid users.
  const { data } = await supabase.rpc("current_location_id");
  return (data as string | null) ?? null;
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

/** Import grid rows into the vendors table (upsert by location_id + vendor_code). */
export async function importVendorsFromGrid(
  payload: GridPayload,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const { headers, rows } = payload;
  const codeI = colIndex(headers, ["vendor code", "code"]);
  const nameI = colIndex(headers, ["vendor name", "name"]);
  if (codeI < 0 || nameI < 0)
    return { error: 'The grid needs "Vendor Code" and "Vendor Name" columns.' };

  const contactI = colIndex(headers, ["contact person", "contact"]);
  const phoneI = colIndex(headers, ["phone"]);
  const emailI = colIndex(headers, ["email"]);
  const bankI = colIndex(headers, ["bank name", "bank"]);
  const accI = colIndex(headers, ["account number", "account"]);
  const ifscI = colIndex(headers, ["ifsc", "ifsc code"]);
  const statusI = colIndex(headers, ["status"]);
  const ALLOWED = new Set(["ACTIVE", "INACTIVE", "BLACKLISTED"]);

  const supabase = await createClient();
  const locationId = await currentLocationId(supabase);
  if (!locationId) return { error: "Your account isn't assigned to a location." };

  const records = rows
    .map((row) => {
      const vendor_code = cell(row, codeI);
      const name = cell(row, nameI);
      if (!vendor_code || !name) return null;
      const status = cell(row, statusI).toUpperCase();
      return {
        vendor_code,
        name,
        contact_person: orNull(cell(row, contactI)),
        phone: orNull(cell(row, phoneI)),
        email: orNull(cell(row, emailI)),
        bank_name: orNull(cell(row, bankI)),
        account_number: orNull(cell(row, accI)),
        ifsc_code: orNull(cell(row, ifscI)),
        status: ALLOWED.has(status) ? status : "ACTIVE",
        location_id: locationId,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (records.length === 0)
    return { error: "No rows with both a Vendor Code and Name to import." };

  const { error } = await supabase
    .from("vendors")
    .upsert(records, { onConflict: "location_id,vendor_code" });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/catalog");
  return {
    success: `Saved ${records.length} vendor(s) to the catalog.`,
    token: crypto.randomUUID(),
  };
}

/** Import grid rows into raw_materials (insert new names; skips existing). */
export async function importMaterialsFromGrid(
  payload: GridPayload,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const { headers, rows } = payload;
  const nameI = colIndex(headers, ["name", "material", "material name", "raw material"]);
  if (nameI < 0) return { error: 'The grid needs a "Name" column.' };

  const brandI = colIndex(headers, ["brand"]);
  const puI = colIndex(headers, ["purchase unit"]);
  const suI = colIndex(headers, ["stock unit", "unit"]);
  const cfI = colIndex(headers, ["conversion factor", "conversion"]);
  const parI = colIndex(headers, ["par level", "par", "reorder level"]);
  const catI = colIndex(headers, ["category"]);

  const supabase = await createClient();
  const locationId = await currentLocationId(supabase);
  if (!locationId) return { error: "Your account isn't assigned to a location." };

  const { data: existingRows } = await supabase.from("raw_materials").select("name");
  const existing = new Set((existingRows ?? []).map((m) => m.name.toLowerCase()));
  const seen = new Set<string>();

  const records = rows
    .map((row) => {
      const name = cell(row, nameI);
      if (!name) return null;
      const k = name.toLowerCase();
      if (existing.has(k) || seen.has(k)) return null;
      seen.add(k);
      const cf = Number(cell(row, cfI)) || 1;
      const par = Number(cell(row, parI)) || 0;
      return {
        name,
        brand: orNull(cell(row, brandI)),
        purchase_unit: cell(row, puI) || "unit",
        stock_unit: cell(row, suI) || "unit",
        conversion_factor: cf > 0 ? cf : 1,
        par_level: par >= 0 ? par : 0,
        category: orNull(cell(row, catI)),
        location_id: locationId,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (records.length === 0)
    return { error: "No new materials to import (all blank or already exist)." };

  const { error } = await supabase.from("raw_materials").insert(records);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/catalog");
  return {
    success: `Saved ${records.length} material(s) to the catalog.`,
    token: crypto.randomUUID(),
  };
}

/** Import grid rows into recipes (insert new names; skips existing). */
export async function importRecipesFromGrid(
  payload: GridPayload,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const { headers, rows } = payload;
  const nameI = colIndex(headers, ["name", "recipe", "recipe name", "dish"]);
  if (nameI < 0) return { error: 'The grid needs a "Name" column.' };

  const priceI = colIndex(headers, ["selling price", "price", "sell"]);
  const catI = colIndex(headers, ["category", "cuisine"]);
  const yieldI = colIndex(headers, ["yield", "yield portions", "portions"]);
  const ovhdI = colIndex(headers, ["overhead", "ovhd", "overhead percentage"]);

  const supabase = await createClient();
  const locationId = await currentLocationId(supabase);
  if (!locationId) return { error: "Your account isn't assigned to a location." };

  const { data: existingRows } = await supabase.from("recipes").select("name");
  const existing = new Set((existingRows ?? []).map((r) => r.name.toLowerCase()));
  const seen = new Set<string>();

  const records = rows
    .map((row) => {
      const name = cell(row, nameI);
      if (!name) return null;
      const k = name.toLowerCase();
      if (existing.has(k) || seen.has(k)) return null;
      seen.add(k);
      const price = Number(cell(row, priceI)) || 0;
      const portions = Math.floor(Number(cell(row, yieldI)) || 1);
      const ovhd = Number(cell(row, ovhdI)) || 0;
      return {
        name,
        selling_price: price >= 0 ? price : 0,
        category: orNull(cell(row, catI)),
        yield_portions: portions > 0 ? portions : 1,
        overhead_percentage: ovhd >= 0 ? ovhd : 0,
        location_id: locationId,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (records.length === 0)
    return { error: "No new recipes to import (all blank or already exist)." };

  const { error } = await supabase.from("recipes").insert(records);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/catalog");
  return {
    success: `Saved ${records.length} recipe(s) to the catalog.`,
    token: crypto.randomUUID(),
  };
}

// --- Vendors -----------------------------------------------------------------

export async function createVendor(
  _prev: CatalogState | undefined,
  fd: FormData,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const vendor_code = str(fd, "vendor_code");
  const name = str(fd, "name");
  if (!vendor_code) return { error: "Vendor code is required." };
  if (!name) return { error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("vendors").insert({
    vendor_code,
    name,
    contact_person: orNull(str(fd, "contact_person")),
    phone: orNull(str(fd, "phone")),
    email: orNull(str(fd, "email")),
    bank_name: orNull(str(fd, "bank_name")),
    account_number: orNull(str(fd, "account_number")),
    ifsc_code: orNull(str(fd, "ifsc_code")),
    status: str(fd, "status") || "ACTIVE",
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Vendor code "${vendor_code}" already exists.`
          : error.message,
    };
  }

  revalidatePath("/dashboard/admin/catalog");
  return { success: `Vendor "${name}" created.`, token: crypto.randomUUID() };
}

export async function deleteVendor(id: string): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("vendors").delete().eq("id", id);
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Can't delete: this vendor has ledger or payment history."
          : error.message,
    };
  }
  revalidatePath("/dashboard/admin/catalog");
  return {};
}

// --- Raw materials -----------------------------------------------------------

export async function createRawMaterial(
  _prev: CatalogState | undefined,
  fd: FormData,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const name = str(fd, "name");
  const purchase_unit = str(fd, "purchase_unit");
  const stock_unit = str(fd, "stock_unit");
  const conversion_factor = Number(fd.get("conversion_factor") ?? 1);
  const par_level = Number(fd.get("par_level") ?? 0);

  if (!name) return { error: "Name is required." };
  if (!purchase_unit) return { error: "Purchase unit is required." };
  if (!stock_unit) return { error: "Stock unit is required." };
  if (!(conversion_factor > 0))
    return { error: "Conversion factor must be greater than zero." };
  if (par_level < 0) return { error: "Par level cannot be negative." };

  const supabase = await createClient();
  const { error } = await supabase.from("raw_materials").insert({
    name,
    brand: orNull(str(fd, "brand")),
    purchase_unit,
    stock_unit,
    conversion_factor,
    par_level,
    category: orNull(str(fd, "category")),
    vendor_id: orNull(str(fd, "vendor_id")),
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/catalog");
  return { success: `Material "${name}" created.`, token: crypto.randomUUID() };
}

export async function deleteRawMaterial(id: string): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("raw_materials").delete().eq("id", id);
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Can't delete: this material is used in the ledger or a recipe."
          : error.message,
    };
  }
  revalidatePath("/dashboard/admin/catalog");
  return {};
}

// --- Recipes -----------------------------------------------------------------

export async function createRecipe(
  _prev: CatalogState | undefined,
  fd: FormData,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const name = str(fd, "name");
  const selling_price = Number(fd.get("selling_price") ?? 0);
  const yield_portions = Math.floor(Number(fd.get("yield_portions") ?? 1));
  const overhead_percentage = Number(fd.get("overhead_percentage") ?? 0);
  const category = orNull(str(fd, "category"));
  const deptRaw = str(fd, "department_id");
  const department_id = deptRaw ? Math.floor(Number(deptRaw)) : null;
  if (!name) return { error: "Recipe name is required." };
  if (selling_price < 0) return { error: "Selling price cannot be negative." };
  if (!(yield_portions > 0))
    return { error: "Yield portions must be at least 1." };
  if (overhead_percentage < 0)
    return { error: "Overhead percentage cannot be negative." };

  // Zip the parallel ingredient_material / ingredient_qty arrays.
  const materialIds = fd.getAll("ingredient_material").map(String);
  const quantities = fd.getAll("ingredient_qty").map((v) => Number(v));
  const ingredients = materialIds
    .map((mId, i) => ({ raw_material_id: mId, quantity_needed: quantities[i] }))
    .filter((x) => x.raw_material_id && x.quantity_needed > 0);

  if (ingredients.length === 0)
    return { error: "Add at least one ingredient with a quantity." };

  const seen = new Set<string>();
  for (const ing of ingredients) {
    if (seen.has(ing.raw_material_id))
      return { error: "Each ingredient can only appear once." };
    seen.add(ing.raw_material_id);
  }

  const supabase = await createClient();

  // A picked department must belong to the caller's (home) location, otherwise
  // the recipe's sales would silently drop out of the location-scoped views.
  if (department_id != null) {
    const { data: home } = await supabase.rpc("current_location_id");
    const { data: dep } = await supabase
      .from("departments")
      .select("id")
      .eq("id", department_id)
      .eq("location_id", (home as string | null) ?? "")
      .maybeSingle();
    if (!dep) return { error: "That department isn't in your location." };
  }

  const { data: recipe, error } = await supabase
    .from("recipes")
    .insert({
      name,
      selling_price,
      yield_portions,
      overhead_percentage,
      category,
      department_id,
    })
    .select("id")
    .single();

  if (error || !recipe) return { error: error?.message ?? "Failed to create recipe." };

  const { error: ingError } = await supabase.from("recipe_ingredients").insert(
    ingredients.map((ing) => ({ recipe_id: recipe.id, ...ing })),
  );

  if (ingError) {
    // Roll back the orphan recipe so the operation is all-or-nothing.
    await supabase.from("recipes").delete().eq("id", recipe.id);
    return { error: ingError.message };
  }

  revalidatePath("/dashboard/admin/catalog");
  return {
    success: `Recipe "${name}" created with ${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"}.`,
    token: crypto.randomUUID(),
  };
}

export async function deleteRecipe(id: string): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Can't delete: this recipe has recorded sales."
          : error.message,
    };
  }
  revalidatePath("/dashboard/admin/catalog");
  return {};
}
