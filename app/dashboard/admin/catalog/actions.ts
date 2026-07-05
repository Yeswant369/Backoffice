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

  const codeI = colIndex(headers, ["code", "material code"]);
  const brandI = colIndex(headers, ["brand"]);
  const puI = colIndex(headers, ["purchase unit"]);
  const suI = colIndex(headers, ["stock unit", "unit"]);
  const cfI = colIndex(headers, ["conversion factor", "conversion"]);
  const parI = colIndex(headers, ["par level", "par", "reorder level"]);
  const catI = colIndex(headers, ["category"]);

  const supabase = await createClient();
  const locationId = await currentLocationId(supabase);
  if (!locationId) return { error: "Your account isn't assigned to a location." };

  const vendI = colIndex(headers, ["vendor", "default vendor", "vendor name"]);

  const [{ data: existingRows }, { data: vendorRows }] = await Promise.all([
    supabase
      .from("raw_materials")
      .select("name, code")
      .eq("location_id", locationId),
    supabase.from("vendors").select("id, name").eq("location_id", locationId),
  ]);
  const existing = new Set((existingRows ?? []).map((m) => m.name.toLowerCase()));
  const seen = new Set<string>();
  // Round-trip the sheet's Vendor column (resolved by name within this outlet).
  const vendorIdByName = new Map(
    (vendorRows ?? []).map((v) => [String(v.name).toLowerCase(), v.id as string]),
  );

  // Codes already taken (DB + earlier rows in this batch). A typed code that
  // collides falls back to auto-numbering rather than aborting the batch, and
  // generated codes skip anything taken.
  const usedCodes = new Set(
    (existingRows ?? []).map((m) => String(m.code ?? "").toUpperCase()).filter(Boolean),
  );
  let seed = (existingRows ?? []).reduce((m, r) => {
    const v = parseInt(String(r.code ?? "").replace(/^RM-0*/, ""), 10);
    return Number.isFinite(v) && v > m ? v : m;
  }, 0);
  const nextFree = () => {
    let c: string;
    do c = `RM-${String(++seed).padStart(4, "0")}`;
    while (usedCodes.has(c));
    return c;
  };

  const records = rows
    .map((row) => {
      const name = cell(row, nameI);
      if (!name) return null;
      const k = name.toLowerCase();
      if (existing.has(k) || seen.has(k)) return null;
      seen.add(k);
      const cf = Number(cell(row, cfI)) || 1;
      const par = Number(cell(row, parI)) || 0;
      const typedCode = (codeI >= 0 ? cell(row, codeI) : "").toUpperCase();
      const code =
        typedCode && !usedCodes.has(typedCode) ? typedCode : nextFree();
      usedCodes.add(code);
      return {
        name,
        code,
        brand: orNull(cell(row, brandI)),
        purchase_unit: cell(row, puI) || "unit",
        stock_unit: cell(row, suI) || "unit",
        conversion_factor: cf > 0 ? cf : 1,
        par_level: par >= 0 ? par : 0,
        category: orNull(cell(row, catI)),
        vendor_id:
          vendI >= 0
            ? (vendorIdByName.get(cell(row, vendI).toLowerCase()) ?? null)
            : null,
        location_id: locationId,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (records.length === 0)
    return { error: "No new materials to import (all blank or already exist)." };

  const { error } = await supabase.from("raw_materials").insert(records);
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Import hit a duplicate material code — re-run the import (codes are re-numbered automatically)."
          : error.message,
    };
  }

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
  const home = await currentLocationId(supabase);
  if (!home) return { error: "Your account isn't assigned to a location." };
  const { data: deleted, error } = await supabase
    .from("vendors")
    .delete()
    .eq("id", id)
    .eq("location_id", home)
    .select("id");
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Can't delete: this vendor has ledger or payment history."
          : error.message,
    };
  }
  if (!deleted || deleted.length === 0) {
    return { error: "Vendor not found in your location." };
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

  // Material code: typed, or auto-generated next RM-#### for this outlet.
  let code = str(fd, "code");
  if (!code) {
    const locationId = await currentLocationId(supabase);
    code = await nextMaterialCode(supabase, locationId);
  }

  const { error } = await supabase.from("raw_materials").insert({
    name,
    code: orNull(code),
    brand: orNull(str(fd, "brand")),
    purchase_unit,
    stock_unit,
    conversion_factor,
    par_level,
    category: orNull(str(fd, "category")),
    vendor_id: orNull(str(fd, "vendor_id")),
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Material code "${code}" is already in use.`
          : error.message,
    };
  }

  revalidatePath("/dashboard/admin/catalog");
  return { success: `Material "${name}" created.`, token: crypto.randomUUID() };
}

/** Next RM-#### after the highest already assigned in this outlet. */
async function nextMaterialCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  locationId: string | null,
): Promise<string> {
  let q = supabase.from("raw_materials").select("code").like("code", "RM-%");
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  const max = (data ?? []).reduce((m, r) => {
    const v = parseInt(String(r.code ?? "").replace(/^RM-0*/, ""), 10);
    return Number.isFinite(v) && v > m ? v : m;
  }, 0);
  return `RM-${String(max + 1).padStart(4, "0")}`;
}

export async function deleteRawMaterial(id: string): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const supabase = await createClient();
  const home = await currentLocationId(supabase);
  if (!home) return { error: "Your account isn't assigned to a location." };
  const { data: deleted, error } = await supabase
    .from("raw_materials")
    .delete()
    .eq("id", id)
    .eq("location_id", home)
    .select("id");
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Can't delete: this material is used in the ledger or a recipe."
          : error.message,
    };
  }
  if (!deleted || deleted.length === 0) {
    return { error: "Material not found in your location." };
  }
  revalidatePath("/dashboard/admin/catalog");
  return {};
}

// --- Recipes -----------------------------------------------------------------

interface IngredientLine {
  raw_material_id: string | null;
  sub_recipe_id: string | null;
  quantity_needed: number;
  notes: string | null;
}

interface RecipeFields {
  name: string;
  selling_price: number;
  yield_portions: number;
  overhead_percentage: number;
  category: string | null;
  course: string | null;
  video_url: string | null;
  pos_item_code: string | null;
  department_id: number | null;
}

/** Parse + harden the recipe form: header fields and the ingredients JSON. */
function parseRecipeForm(
  fd: FormData,
): { fields: RecipeFields; ingredients: IngredientLine[] } | { error: string } {
  const name = str(fd, "name");
  const selling_price = Number(fd.get("selling_price") ?? 0);
  const yield_portions = Math.floor(Number(fd.get("yield_portions") ?? 1));
  const overhead_percentage = Number(fd.get("overhead_percentage") ?? 0);
  const deptRaw = str(fd, "department_id");
  const video = str(fd, "video_url");
  if (!name) return { error: "Recipe name is required." };
  if (!Number.isFinite(selling_price) || selling_price < 0 || selling_price >= 1e10)
    return { error: "Selling price must be a valid non-negative number." };
  if (!Number.isFinite(yield_portions) || yield_portions <= 0 || yield_portions > 10000)
    return { error: "Yield portions must be at least 1." };
  if (!Number.isFinite(overhead_percentage) || overhead_percentage < 0 || overhead_percentage > 1000)
    return { error: "Overhead percentage must be between 0 and 1000." };
  if (video && !/^https?:\/\/\S+$/i.test(video))
    return { error: "Video link must be an http(s) URL." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "ingredients_json") || "[]");
  } catch {
    return { error: "Invalid ingredient rows." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    return { error: "Add at least one ingredient with a quantity." };
  if (parsed.length > 200) return { error: "Too many ingredient rows." };

  const ingredients: IngredientLine[] = [];
  const seenMat = new Set<string>();
  const seenSub = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") return { error: "Invalid ingredient rows." };
    const l = raw as Record<string, unknown>;
    const mat = typeof l.raw_material_id === "string" && l.raw_material_id ? l.raw_material_id : null;
    const sub = typeof l.sub_recipe_id === "string" && l.sub_recipe_id ? l.sub_recipe_id : null;
    const qty = Number(l.quantity_needed);
    const notes = typeof l.notes === "string" ? l.notes.trim().slice(0, 500) : "";
    if ((mat === null) === (sub === null))
      return { error: "Every ingredient row needs a material OR a sub-recipe." };
    if (!Number.isFinite(qty) || qty <= 0 || qty >= 1e10)
      return { error: "Every ingredient quantity must be greater than zero." };
    if (mat) {
      if (seenMat.has(mat)) return { error: "Each material can only appear once." };
      seenMat.add(mat);
    }
    if (sub) {
      if (seenSub.has(sub)) return { error: "Each sub-recipe can only appear once." };
      seenSub.add(sub);
    }
    ingredients.push({
      raw_material_id: mat,
      sub_recipe_id: sub,
      quantity_needed: qty,
      notes: notes || null,
    });
  }

  return {
    fields: {
      name,
      selling_price,
      yield_portions,
      overhead_percentage,
      category: orNull(str(fd, "category")),
      course: orNull(str(fd, "course")),
      video_url: orNull(video),
      pos_item_code: orNull(str(fd, "pos_item_code")),
      department_id: deptRaw ? Math.floor(Number(deptRaw)) : null,
    },
    ingredients,
  };
}

/** Department must belong to the caller's home location (else its sales vanish
 *  from location-scoped views). Returns an error string or null. */
async function validateRecipeRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  home: string,
  fields: RecipeFields,
  ingredients: IngredientLine[],
): Promise<string | null> {
  if (fields.department_id != null) {
    const { data: dep } = await supabase
      .from("departments")
      .select("id")
      .eq("id", fields.department_id)
      .eq("location_id", home)
      .maybeSingle();
    if (!dep) return "That department isn't in your location.";
  }
  const matIds = ingredients.filter((i) => i.raw_material_id).map((i) => i.raw_material_id as string);
  if (matIds.length > 0) {
    const { data } = await supabase
      .from("raw_materials")
      .select("id")
      .in("id", [...new Set(matIds)])
      .eq("location_id", home);
    if ((data ?? []).length !== new Set(matIds).size)
      return "One or more materials weren't found in your location.";
  }
  const subIds = ingredients.filter((i) => i.sub_recipe_id).map((i) => i.sub_recipe_id as string);
  if (subIds.length > 0) {
    const { data } = await supabase
      .from("recipes")
      .select("id")
      .in("id", [...new Set(subIds)])
      .eq("location_id", home);
    if ((data ?? []).length !== new Set(subIds).size)
      return "One or more sub-recipes weren't found in your location.";
  }
  return null;
}

/** Call the atomic save_recipe RPC and map its errors to friendly messages. */
async function callSaveRecipe(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recipeId: string | null,
  fields: RecipeFields,
  ingredients: IngredientLine[],
): Promise<{ error: string } | { id: string }> {
  const { data, error } = await supabase.rpc("save_recipe", {
    p_recipe_id: recipeId,
    p_fields: {
      name: fields.name,
      selling_price: String(fields.selling_price),
      yield_portions: String(fields.yield_portions),
      overhead_percentage: String(fields.overhead_percentage),
      category: fields.category ?? "",
      course: fields.course ?? "",
      video_url: fields.video_url ?? "",
      pos_item_code: fields.pos_item_code ?? "",
      department_id: fields.department_id != null ? String(fields.department_id) : "",
    },
    p_ingredients: ingredients,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("CYCLE:"))
      return { error: "That sub-recipe (directly or indirectly) contains this recipe — cycles aren't allowed." };
    if (msg.includes("NOT_FOUND:")) return { error: "Recipe not found in your location." };
    if (msg.includes("NO_INGREDIENTS:")) return { error: "Add at least one ingredient with a quantity." };
    if (error.code === "23505")
      return { error: `POS code "${fields.pos_item_code}" is already mapped to another recipe.` };
    return { error: msg || "Failed to save the recipe." };
  }
  return { id: data as string };
}

export async function createRecipe(
  _prev: CatalogState | undefined,
  fd: FormData,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const parsed = parseRecipeForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const { fields, ingredients } = parsed;

  const supabase = await createClient();
  const home = await currentLocationId(supabase);
  if (!home) return { error: "Your account isn't assigned to a location." };
  const refErr = await validateRecipeRefs(supabase, home, fields, ingredients);
  if (refErr) return { error: refErr };

  // Atomic: header + ingredients + cycle check commit or roll back together.
  const saved = await callSaveRecipe(supabase, null, fields, ingredients);
  if ("error" in saved) return { error: saved.error };

  revalidatePath("/dashboard/admin/catalog");
  revalidatePath("/dashboard/admin/recipes");
  return {
    success: `Recipe "${fields.name}" created with ${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"}.`,
    token: crypto.randomUUID(),
  };
}

/**
 * Update a recipe (header + full ingredient replacement) via the ATOMIC
 * save_recipe RPC: header update, delete+re-insert of ingredient rows, and the
 * sub-recipe cycle check run in ONE transaction under a per-location advisory
 * lock. A committed cycle would silently TRUNCATE recipe_cogs (undercosted
 * COGS) and push every POS sale of the dish to unmapped_sales — the in-DB
 * post-insert check under the lock makes that unreachable.
 */
export async function updateRecipe(
  _prev: CatalogState | undefined,
  fd: FormData,
): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const id = str(fd, "recipe_id");
  if (!id) return { error: "Missing recipe." };

  const parsed = parseRecipeForm(fd);
  if ("error" in parsed) return { error: parsed.error };
  const { fields, ingredients } = parsed;

  const supabase = await createClient();
  const home = await currentLocationId(supabase);
  if (!home) return { error: "Your account isn't assigned to a location." };

  const refErr = await validateRecipeRefs(supabase, home, fields, ingredients);
  if (refErr) return { error: refErr };

  // Fast-path guard for the trivial case (friendlier than the RPC error).
  if (ingredients.some((i) => i.sub_recipe_id === id)) {
    return { error: "A recipe can't contain itself." };
  }

  const saved = await callSaveRecipe(supabase, id, fields, ingredients);
  if ("error" in saved) return { error: saved.error };

  revalidatePath("/dashboard/admin/catalog");
  revalidatePath("/dashboard/admin/recipes");
  revalidatePath(`/dashboard/admin/recipes/${id}`);
  return { success: `Recipe "${fields.name}" updated (${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"}).`, token: crypto.randomUUID() };
}

export async function deleteRecipe(id: string): Promise<CatalogState> {
  const denied = await guard();
  if (denied) return { error: denied };

  const supabase = await createClient();
  const home = await currentLocationId(supabase);
  if (!home) return { error: "Your account isn't assigned to a location." };
  const { data: deleted, error } = await supabase
    .from("recipes")
    .delete()
    .eq("id", id)
    .eq("location_id", home)
    .select("id");
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Can't delete: this recipe has recorded sales or is a sub-recipe of another dish."
          : error.message,
    };
  }
  if (!deleted || deleted.length === 0) {
    return { error: "Recipe not found in your location." };
  }
  revalidatePath("/dashboard/admin/catalog");
  return {};
}
